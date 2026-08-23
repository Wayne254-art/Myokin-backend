import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async.js';
import { AppError } from '../utils/errors.js';
import { calculateDelivery, calculateDiscount, calculateTax, calculateTotal } from '../services/pricing.js';
export const ordersRouter = Router();
ordersRouter.use(authenticate);
const address = z.object({ firstName: z.string().min(2), lastName: z.string().min(2), email: z.string().email(), phone: z.string().min(9), county: z.string().min(2), town: z.string().min(2), addressLine1: z.string().min(5), landmark: z.string().optional(), notes: z.string().optional() });
ordersRouter.post('/', asyncHandler(async (req, res) => {
    const input = z.object({ address, deliveryZoneId: z.string(), couponCode: z.string().optional(), paymentMethod: z.literal('PAYSTACK') }).parse(req.body);
    const cart = await prisma.cart.findFirst({ where: { userId: req.user.id }, include: { items: { include: { product: { include: { images: { take: 1 } } }, variant: true } } } });
    if (!cart?.items.length)
        throw new AppError(400, 'Your beauty bag is empty.');
    const zone = await prisma.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, isActive: true } });
    if (!zone)
        throw new AppError(400, 'That delivery area is not currently available.');
    const subtotal = cart.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
    let coupon = null;
    if (input.couponCode) {
        const now = new Date();
        coupon = await prisma.coupon.findUnique({ where: { code: input.couponCode.toUpperCase() } });
        if (!coupon)
            throw new AppError(400, 'Invalid coupon.');
        if (!coupon.isActive || (coupon.startsAt && coupon.startsAt > now) || (coupon.expiresAt && coupon.expiresAt < now) || (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit))
            throw new AppError(400, 'Expired coupon.');
        if (coupon.minimumSpend && subtotal < Number(coupon.minimumSpend))
            throw new AppError(400, `This coupon requires a minimum spend of KSh ${Number(coupon.minimumSpend).toLocaleString()}.`);
    }
    const couponId = coupon?.id;
    const discount = calculateDiscount(subtotal, coupon && { type: coupon.type, value: Number(coupon.value), minimumSpend: coupon.minimumSpend == null ? null : Number(coupon.minimumSpend), maximumDiscount: coupon.maximumDiscount == null ? null : Number(coupon.maximumDiscount) });
    const deliveryFee = calculateDelivery(subtotal, Number(zone.fee), zone.freeDeliveryThreshold == null ? null : Number(zone.freeDeliveryThreshold));
    const settings = await prisma.storeSetting.findUnique({ where: { id: 'store' } });
    const tax = calculateTax(subtotal, discount, Number(settings?.taxRate ?? 0));
    const total = calculateTotal(subtotal, discount, deliveryFee, tax);
    const order = await prisma.$transaction(async (tx) => {
        for (const item of cart.items) {
            const stock = item.variant?.stockQuantity ?? item.product.stockQuantity;
            if (!item.product.isActive || stock < item.quantity)
                throw new AppError(409, `${item.product.name} does not have enough stock.`);
        }
        const count = await tx.order.count();
        const orderNumber = `MYK-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`;
        const created = await tx.order.create({ data: { orderNumber, userId: req.user.id, subtotal, discount, deliveryFee, tax, total, shippingAddress: input.address, paymentMethod: input.paymentMethod, notes: input.address.notes, couponId, items: { create: cart.items.map(item => ({ productId: item.productId, variantId: item.variantId, productName: item.product.name, sku: item.variant?.sku ?? item.product.sku, image: item.product.images[0]?.url, quantity: item.quantity, unitPrice: item.unitPrice, total: Number(item.unitPrice) * item.quantity })) }, statusHistory: { create: { status: 'PENDING', note: 'Order received' } } }, include: { items: true } });
        if (couponId)
            await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { increment: 1 } } });
        return created;
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ success: true, data: order });
}));
ordersRouter.get('/', asyncHandler(async (req, res) => res.json({ success: true, data: await prisma.order.findMany({ where: { userId: req.user.id }, include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }) })));
ordersRouter.get('/:orderNumber', asyncHandler(async (req, res) => { const order = await prisma.order.findFirst({ where: { orderNumber: String(req.params.orderNumber), userId: req.user.id }, include: { items: true, payments: true, statusHistory: { orderBy: { createdAt: 'asc' } } } }); if (!order)
    throw new AppError(404, 'Order not found.'); res.json({ success: true, data: order }); }));

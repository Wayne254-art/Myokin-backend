import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async.js';
import { AppError } from '../utils/errors.js';
import { calculateDelivery, calculateDiscount, calculateTax, calculateTotal } from '../services/pricing.js';
export const cartRouter = Router();
const cartInclude = { items: { include: { product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } }, brand: true } }, variant: true }, orderBy: { createdAt: 'asc' } } };
const identity = (req) => req.user ? { userId: req.user.id } : req.sessionId ? { sessionId: req.sessionId } : null;
const getCart = async (req, create = false) => { const owner = identity(req); if (!owner)
    throw new AppError(400, 'A session ID is required.'); const cart = await prisma.cart.findFirst({ where: owner, include: cartInclude }); if (cart || !create)
    return cart; return prisma.cart.create({ data: owner, include: cartInclude }); };
cartRouter.get('/', asyncHandler(async (req, res) => res.json({ success: true, data: await getCart(req) })));
cartRouter.post('/quote', asyncHandler(async (req, res) => {
    const input = z.object({ couponCode: z.string().trim().optional(), deliveryZoneId: z.string().optional() }).parse(req.body);
    const cart = await getCart(req);
    const items = cart?.items ?? [];
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
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
    const discount = calculateDiscount(subtotal, coupon && { type: coupon.type, value: Number(coupon.value), minimumSpend: coupon.minimumSpend == null ? null : Number(coupon.minimumSpend), maximumDiscount: coupon.maximumDiscount == null ? null : Number(coupon.maximumDiscount) });
    const zone = input.deliveryZoneId ? await prisma.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, isActive: true } }) : null;
    if (input.deliveryZoneId && !zone)
        throw new AppError(400, 'That delivery area is not currently available.');
    const settings = await prisma.storeSetting.findUnique({ where: { id: 'store' } });
    const taxRate = Number(settings?.taxRate ?? 0);
    const tax = calculateTax(subtotal, discount, taxRate);
    const deliveryFee = zone ? calculateDelivery(subtotal, Number(zone.fee), zone.freeDeliveryThreshold == null ? null : Number(zone.freeDeliveryThreshold)) : null;
    const total = calculateTotal(subtotal, discount, deliveryFee ?? 0, tax);
    res.json({ success: true, data: { itemCount, subtotal, discount, taxableAmount: Math.max(0, subtotal - discount), taxRate, tax, deliveryFee, total, deliveryPending: !zone, coupon: coupon ? { code: coupon.code, description: coupon.description } : null, deliveryZone: zone ? { id: zone.id, name: zone.name, estimatedDays: zone.estimatedDays } : null } });
}));
cartRouter.post('/items', asyncHandler(async (req, res) => { const input = z.object({ productId: z.string(), variantId: z.string().optional(), quantity: z.number().int().min(1).max(20).default(1), replace: z.boolean().default(false) }).parse(req.body); const product = await prisma.product.findFirst({ where: { id: input.productId, isActive: true }, include: { variants: true } }); if (!product)
    throw new AppError(404, 'Product not found.'); const cart = await getCart(req, true); const existing = await prisma.cartItem.findFirst({ where: { cartId: cart.id, productId: product.id, variantId: input.variantId ?? null } }); const finalQuantity = existing && !input.replace ? existing.quantity + input.quantity : input.quantity; const stock = input.variantId ? product.variants.find(v => v.id === input.variantId)?.stockQuantity : product.stockQuantity; if (stock == null || stock < finalQuantity)
    throw new AppError(409, `Only ${stock ?? 0} item(s) are currently available.`); if (existing)
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: finalQuantity } });
else
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: input.productId, variantId: input.variantId, quantity: input.quantity, unitPrice: input.variantId ? product.variants.find(v => v.id === input.variantId)?.price ?? product.price : product.price } }); res.status(201).json({ success: true, data: await getCart(req) }); }));
cartRouter.patch('/items/:id', asyncHandler(async (req, res) => { const { quantity } = z.object({ quantity: z.number().int().min(1).max(20) }).parse(req.body); const cart = await getCart(req); const item = cart?.items.find(i => i.id === String(req.params.id)); if (!item)
    throw new AppError(404, 'Bag item not found.'); const stock = item.variant?.stockQuantity ?? item.product.stockQuantity; if (stock < quantity)
    throw new AppError(409, `Only ${stock} item(s) are currently available.`); await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } }); res.json({ success: true, data: await getCart(req) }); }));
cartRouter.delete('/items/:id', asyncHandler(async (req, res) => { const cart = await getCart(req); if (!cart?.items.some(i => i.id === String(req.params.id)))
    throw new AppError(404, 'Bag item not found.'); await prisma.cartItem.delete({ where: { id: String(req.params.id) } }); res.status(204).end(); }));
cartRouter.post('/merge', authenticate, asyncHandler(async (req, res) => { const { sessionId } = z.object({ sessionId: z.string() }).parse(req.body); const guest = await prisma.cart.findUnique({ where: { sessionId }, include: { items: true } }); const userCart = await prisma.cart.upsert({ where: { sessionId: `user:${req.user.id}` }, update: { userId: req.user.id }, create: { userId: req.user.id, sessionId: `user:${req.user.id}` } }); if (guest && guest.id !== userCart.id)
    await prisma.$transaction(async (tx) => { for (const item of guest.items) {
        const existing = await tx.cartItem.findFirst({ where: { cartId: userCart.id, productId: item.productId, variantId: item.variantId } });
        if (existing)
            await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: { increment: item.quantity } } });
        else
            await tx.cartItem.create({ data: { cartId: userCart.id, productId: item.productId, variantId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice } });
    } await tx.cart.delete({ where: { id: guest.id } }); }); res.json({ success: true, data: await prisma.cart.findUnique({ where: { id: userCart.id }, include: cartInclude }) }); }));
export const wishlistRouter = Router();
wishlistRouter.use(authenticate);
wishlistRouter.get('/', asyncHandler(async (req, res) => res.json({ success: true, data: await prisma.wishlist.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id }, update: {}, include: { items: { include: { product: { include: { images: { take: 1 }, brand: true, category: true } } } } } }) })));
wishlistRouter.post('/:productId', asyncHandler(async (req, res) => { const wishlist = await prisma.wishlist.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id }, update: {} }); await prisma.wishlistItem.upsert({ where: { wishlistId_productId: { wishlistId: wishlist.id, productId: String(req.params.productId) } }, create: { wishlistId: wishlist.id, productId: String(req.params.productId) }, update: {} }); res.status(201).json({ success: true, data: await prisma.wishlist.findUnique({ where: { id: wishlist.id }, include: { items: { include: { product: { include: { images: { take: 1 }, brand: true, category: true } } } } } }) }); }));
wishlistRouter.delete('/:productId', asyncHandler(async (req, res) => { const wishlist = await prisma.wishlist.findUnique({ where: { userId: req.user.id } }); if (wishlist)
    await prisma.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id, productId: String(req.params.productId) } }); res.status(204).end(); }));

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../utils/async.js'
import { AppError } from '../utils/errors.js'

export const ordersRouter = Router()
ordersRouter.use(authenticate)
const address = z.object({ firstName: z.string().min(2), lastName: z.string().min(2), email: z.string().email(), phone: z.string().min(9), county: z.string().min(2), town: z.string().min(2), addressLine1: z.string().min(5), landmark: z.string().optional(), notes: z.string().optional() })
ordersRouter.post('/', asyncHandler(async (req, res) => {
  const input = z.object({ address, deliveryZoneId: z.string(), couponCode: z.string().optional(), paymentMethod: z.literal('PAYSTACK') }).parse(req.body)
  const cart = await prisma.cart.findFirst({ where: { userId: req.user!.id }, include: { items: { include: { product: { include: { images: { take: 1 } } }, variant: true } } } })
  if (!cart?.items.length) throw new AppError(400, 'Your beauty bag is empty.')
  const zone = await prisma.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, isActive: true } })
  if (!zone) throw new AppError(400, 'That delivery area is not currently available.')
  const subtotal = cart.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
  let discount = 0; let couponId: string | undefined
  if (input.couponCode) { const now = new Date(); const coupon = await prisma.coupon.findFirst({ where: { code: input.couponCode.toUpperCase(), isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }] } }); if (!coupon || (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit)) throw new AppError(400, 'That coupon has expired or is unavailable.'); if (coupon.minimumSpend && subtotal < Number(coupon.minimumSpend)) throw new AppError(400, `This coupon requires a minimum spend of KSh ${Number(coupon.minimumSpend).toLocaleString()}.`); discount = coupon.type === 'PERCENTAGE' ? subtotal * Number(coupon.value) / 100 : Number(coupon.value); if (coupon.maximumDiscount) discount = Math.min(discount, Number(coupon.maximumDiscount)); discount = Math.min(discount, subtotal); couponId = coupon.id }
  const deliveryFee = zone.freeDeliveryThreshold && subtotal >= Number(zone.freeDeliveryThreshold) ? 0 : Number(zone.fee)
  const total = subtotal - discount + deliveryFee
  const order = await prisma.$transaction(async (tx) => {
    for (const item of cart.items) { const stock = item.variant?.stockQuantity ?? item.product.stockQuantity; if (!item.product.isActive || stock < item.quantity) throw new AppError(409, `${item.product.name} does not have enough stock.`) }
    const count = await tx.order.count(); const orderNumber = `MYK-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`
    const created = await tx.order.create({ data: { orderNumber, userId: req.user!.id, subtotal, discount, deliveryFee, total, shippingAddress: input.address, paymentMethod: input.paymentMethod, notes: input.address.notes, couponId, items: { create: cart.items.map(item => ({ productId: item.productId, variantId: item.variantId, productName: item.product.name, sku: item.variant?.sku ?? item.product.sku, image: item.product.images[0]?.url, quantity: item.quantity, unitPrice: item.unitPrice, total: Number(item.unitPrice) * item.quantity })) }, statusHistory: { create: { status: 'PENDING', note: 'Order received' } } }, include: { items: true } })
    if (couponId) await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { increment: 1 } } })
    return created
  }, { isolationLevel: 'Serializable' })
  res.status(201).json({ success: true, data: order })
}))
ordersRouter.get('/', asyncHandler(async (req, res) => res.json({ success: true, data: await prisma.order.findMany({ where: { userId: req.user!.id }, include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }) })))
ordersRouter.get('/:orderNumber', asyncHandler(async (req, res) => { const order = await prisma.order.findFirst({ where: { orderNumber: String(req.params.orderNumber), userId: req.user!.id }, include: { items: true, payments: true, statusHistory: { orderBy: { createdAt: 'asc' } } } }); if (!order) throw new AppError(404, 'Order not found.'); res.json({ success: true, data: order }) }))



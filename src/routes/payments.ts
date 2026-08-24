import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../utils/async.js'
import { AppError } from '../utils/errors.js'

export const paymentsRouter = Router()
const paystack = async (path: string, init?: RequestInit) => { if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'Online payment is not configured yet.'); const response = await fetch(`https://api.paystack.co${path}`, { ...init, headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...init?.headers } }); const body = await response.json() as { status: boolean; message: string; data: any }; if (!response.ok || !body.status) throw new AppError(502, body.message || "We couldn't complete your payment."); return body.data }
paymentsRouter.post('/paystack/initialize', authenticate, asyncHandler(async (req, res) => { const { orderNumber } = z.object({ orderNumber: z.string() }).parse(req.body); const order = await prisma.order.findFirst({ where: { orderNumber, userId: req.user!.id, paymentStatus: 'PENDING' }, include: { user: true } }); if (!order) throw new AppError(404, 'Pending order not found.'); const reference = `${order.orderNumber}-${crypto.randomUUID()}`; const data = await paystack('/transaction/initialize', { method: 'POST', body: JSON.stringify({ email: order.user!.email, amount: Math.round(Number(order.total) * 100), currency: 'KES', reference, callback_url: env.PAYSTACK_CALLBACK_URL, metadata: { orderId: order.id, orderNumber: order.orderNumber } }) }); await prisma.payment.create({ data: { orderId: order.id, userId: req.user!.id, provider: 'PAYSTACK', reference, amount: order.total, status: 'INITIALIZED', rawResponse: data } }); await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'INITIALIZED' } }); res.json({ success: true, data: { authorizationUrl: data.authorization_url, reference } }) }))
paymentsRouter.get('/paystack/verify/:reference', authenticate, asyncHandler(async (req, res) => { const payment = await prisma.payment.findFirst({ where: { reference: String(req.params.reference), userId: req.user!.id },include:{order:{select:{orderNumber:true}}} }); if (!payment) throw new AppError(404, 'Payment not found.'); const data = await paystack(`/transaction/verify/${encodeURIComponent(payment.reference)}`); await confirmPayment(payment.reference, data); res.json({ success: true, data: { status: data.status, reference: payment.reference,orderNumber:payment.order.orderNumber } }) }))
paymentsRouter.post('/paystack/webhook', asyncHandler(async (req, res) => { if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'Payment is not configured.'); const signature = req.header('x-paystack-signature'); const digest = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(req.rawBody ?? Buffer.from(JSON.stringify(req.body))).digest('hex'); if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) throw new AppError(401, 'Invalid webhook signature.'); if (req.body.event === 'charge.success') await confirmPayment(req.body.data.reference, req.body.data); res.status(200).json({ received: true }) }))

async function confirmPayment(reference: string, gateway: any) {
  const complete = async () => prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { reference }, include: { order: { include: { items: true } } } })
    if (!payment || payment.status === 'PAID') return
    if (gateway.status !== 'success' || gateway.currency !== 'KES' || Number(gateway.amount) !== Math.round(Number(payment.amount) * 100)) throw new AppError(400, 'Payment verification did not match the order total.')
    for (const item of payment.order.items) {
      if (item.variantId) { const result = await tx.productVariant.updateMany({ where: { id: item.variantId, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } }); if (!result.count) throw new AppError(409, `${item.productName} is out of stock.`) }
      else { const result = await tx.product.updateMany({ where: { id: item.productId, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } }); if (!result.count) throw new AppError(409, `${item.productName} is out of stock.`) }
    }
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', channel: gateway.channel, paidAt: new Date(), gatewayResponse: gateway.gateway_response, rawResponse: gateway } })
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PAID', status: 'CONFIRMED', statusHistory: { create: { status: 'CONFIRMED', note: 'Payment confirmed' } } } })
    // Keep the user's bag ready for their next purchase, but remove every item that
    // was just bought. Deleting cart items avoids a parent-record delete race.
    if (payment.userId) await tx.cartItem.deleteMany({ where: { cart: { userId: payment.userId } } })
  }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 })

  // The Paystack callback and the browser verification can arrive together. Retrying
  // serialisation/expired-transaction conflicts makes payment confirmation idempotent.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await complete(); return }
    catch (error: any) {
      const retryable = error?.code === 'P2028' || error?.code === 'P2034'
      if (!retryable || attempt === 2) throw error
    }
  }
}



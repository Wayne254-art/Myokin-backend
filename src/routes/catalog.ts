import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { asyncHandler } from '../utils/async.js'
import { AppError } from '../utils/errors.js'

export const catalogRouter = Router()
catalogRouter.get('/products', asyncHandler(async (req, res) => {
  const q = z.object({ search: z.string().optional(), category: z.string().optional(), brand: z.string().optional(), minPrice: z.coerce.number().nonnegative().optional(), maxPrice: z.coerce.number().positive().optional(), sort: z.enum(['newest','price-asc','price-desc','rating','recommended']).default('recommended'), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(48).default(12) }).parse(req.query)
  const where: Prisma.ProductWhereInput = { isActive: true, status: 'ACTIVE', category: q.category ? { slug: q.category } : undefined, brand: q.brand ? { slug: q.brand } : undefined, price: { gte: q.minPrice, lte: q.maxPrice }, OR: q.search ? [{ name: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search, mode: 'insensitive' } }, { brand: { name: { contains: q.search, mode: 'insensitive' } } }] : undefined }
  const orderBy: Prisma.ProductOrderByWithRelationInput = q.sort === 'price-asc' ? { price: 'asc' } : q.sort === 'price-desc' ? { price: 'desc' } : q.sort === 'rating' ? { averageRating: 'desc' } : q.sort === 'newest' ? { createdAt: 'desc' } : { isFeatured: 'desc' }
  const [items, total] = await prisma.$transaction([prisma.product.findMany({ where, include: { brand: true, category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { where: { isActive: true } } }, orderBy, skip: (q.page - 1) * q.limit, take: q.limit }), prisma.product.count({ where })])
  res.json({ success: true, data: items, meta: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } })
}))
catalogRouter.get('/products/:slug', asyncHandler(async (req, res) => { const item = await prisma.product.findFirst({ where: { slug: String(req.params.slug), isActive: true }, include: { brand: true, category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { where: { isActive: true } }, reviews: { where: { status: 'APPROVED' }, include: { user: { select: { firstName: true, lastName: true } } } } } }); if (!item) throw new AppError(404, 'Product not found.'); res.json({ success: true, data: item }) }))
catalogRouter.get('/categories', asyncHandler(async (_req, res) => res.json({ success: true, data: await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }) })))
catalogRouter.get('/brands', asyncHandler(async (_req, res) => res.json({ success: true, data: await prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }) })))
catalogRouter.get('/banners', asyncHandler(async (_req, res) => { const now = new Date(); res.json({ success: true, data: await prisma.banner.findMany({ where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] } }) }) }))



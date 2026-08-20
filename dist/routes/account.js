import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async.js';
import { AppError } from '../utils/errors.js';
export const accountRouter = Router();
accountRouter.use(authenticate);
accountRouter.patch('/profile', asyncHandler(async (req, res) => { const data = z.object({ firstName: z.string().min(2).optional(), lastName: z.string().min(2).optional(), phone: z.string().min(9).optional(), avatar: z.string().url().optional() }).parse(req.body); const user = await prisma.user.update({ where: { id: req.user.id }, data, select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true, role: true } }); res.json({ success: true, data: user }); }));
accountRouter.patch('/password', asyncHandler(async (req, res) => { const data = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(72) }).parse(req.body); const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } }); if (!await bcrypt.compare(data.currentPassword, user.passwordHash))
    throw new AppError(400, 'Your current password is incorrect.'); await prisma.$transaction([prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(data.newPassword, 12) } }), prisma.refreshToken.deleteMany({ where: { userId: user.id } })]); res.status(204).end(); }));
accountRouter.get('/addresses', asyncHandler(async (req, res) => res.json({ success: true, data: await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: { isDefault: 'desc' } }) })));
const address = z.object({ label: z.string().min(2), firstName: z.string().min(2), lastName: z.string().min(2), phone: z.string().min(9), county: z.string().min(2), town: z.string().min(2), addressLine1: z.string().min(5), addressLine2: z.string().optional(), landmark: z.string().optional(), postalCode: z.string().optional(), isDefault: z.boolean().default(false) });
accountRouter.post('/addresses', asyncHandler(async (req, res) => { const data = address.parse(req.body); const created = await prisma.$transaction(async (tx) => { if (data.isDefault)
    await tx.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } }); return tx.address.create({ data: { ...data, userId: req.user.id } }); }); res.status(201).json({ success: true, data: created }); }));
accountRouter.patch('/addresses/:id', asyncHandler(async (req, res) => { const id = String(req.params.id); const owned = await prisma.address.findFirst({ where: { id, userId: req.user.id } }); if (!owned)
    throw new AppError(404, 'Address not found.'); const data = address.partial().parse(req.body); if (data.isDefault)
    await prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } }); res.json({ success: true, data: await prisma.address.update({ where: { id }, data }) }); }));
accountRouter.delete('/addresses/:id', asyncHandler(async (req, res) => { const result = await prisma.address.deleteMany({ where: { id: String(req.params.id), userId: req.user.id } }); if (!result.count)
    throw new AppError(404, 'Address not found.'); res.status(204).end(); }));

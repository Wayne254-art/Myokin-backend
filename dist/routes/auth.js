import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/async.js';
import { AppError } from '../utils/errors.js';
import { hashToken, refreshCookie, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { authenticate } from '../middleware/auth.js';
export const authRouter = Router();
authRouter.use(rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
const credentials = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(8).max(72) });
const publicUser = { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, avatar: true };
authRouter.post('/register', asyncHandler(async (req, res) => {
    const data = credentials.extend({ firstName: z.string().min(2), lastName: z.string().min(2), phone: z.preprocess(v => v === '' ? undefined : v, z.string().min(9).optional()) }).parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const profile = { firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone };
    const user = await prisma.user.create({ data: { ...profile, passwordHash }, select: publicUser });
    await issueSession(user.id, user.role, res);
    res.status(201).json({ success: true, data: { user, accessToken: signAccessToken(user.id, user.role) } });
}));
authRouter.post('/login', asyncHandler(async (req, res) => {
    const data = credentials.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (!existing || !await bcrypt.compare(data.password, existing.passwordHash))
        throw new AppError(401, 'Incorrect Credentials.');
    if (existing.status === 'SUSPENDED')
        throw new AppError(403, 'Account has been suspended. Please contact support.');
    if (existing.status === 'DISABLED')
        throw new AppError(403, 'Account has been disabled. Please contact support.');
    await issueSession(existing.id, existing.role, res);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, select: publicUser });
    res.json({ success: true, data: { user, accessToken: signAccessToken(user.id, user.role) } });
}));
authRouter.post('/refresh', asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token)
        throw new AppError(401, 'Your session has expired. Please sign in again.');
    let payload;
    try {
        payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
    }
    catch {
        // A stale, corrupted, or manually altered cookie is an expected client-side state.
        // Clear it and return a normal authentication response instead of logging a stack trace.
        res.clearCookie('refreshToken', { path: '/api/auth' });
        throw new AppError(401, 'Your session has expired. Please sign in again.');
    }
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date() || stored.user.status !== 'ACTIVE' || stored.userId !== payload.sub) {
        res.clearCookie('refreshToken', { path: '/api/auth' });
        throw new AppError(401, 'Your session has expired. Please sign in again.');
    }
    // Rotate the refresh credential on every use so a copied/old token cannot be replayed.
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    await issueSession(stored.user.id, stored.user.role, res);
    res.json({ success: true, data: { accessToken: signAccessToken(stored.user.id, stored.user.role) } });
}));
authRouter.post('/logout', asyncHandler(async (req, res) => { const token = req.cookies?.refreshToken; if (token)
    await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(token) } }); res.clearCookie('refreshToken', { path: '/api/auth' }); res.status(204).end(); }));
authRouter.get('/me', authenticate, asyncHandler(async (req, res) => { const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: publicUser }); res.json({ success: true, data: user }); }));
async function issueSession(id, role, res) {
    const refreshToken = signRefreshToken(id);
    await prisma.refreshToken.create({ data: { userId: id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    res.cookie('refreshToken', refreshToken, refreshCookie);
}

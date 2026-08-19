import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
export const optionalAuth = (req, _res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token)
        try {
            const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
            req.user = { id: String(payload.sub), role: payload.role };
        }
        catch { /* anonymous */ }
    req.sessionId = req.header('x-session-id') || undefined;
    next();
};
export const authenticate = (req, _res, next) => req.user ? next() : next(new AppError(401, 'Your session has expired. Please sign in again.'));
export const authorize = (...roles) => (req, _res, next) => req.user && roles.includes(req.user.role) ? next() : next(new AppError(403, 'You do not have permission to do that.'));

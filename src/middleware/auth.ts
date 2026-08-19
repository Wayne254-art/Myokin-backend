import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import type { Role } from '@prisma/client'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (token) try { const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload; req.user = { id: String(payload.sub), role: payload.role as Role } } catch { /* anonymous */ }
  req.sessionId = req.header('x-session-id') || undefined
  next()
}
export const authenticate: RequestHandler = (req, _res, next) => req.user ? next() : next(new AppError(401, 'Your session has expired. Please sign in again.'))
export const authorize = (...roles: Role[]): RequestHandler => (req, _res, next) => req.user && roles.includes(req.user.role) ? next() : next(new AppError(403, 'You do not have permission to do that.'))


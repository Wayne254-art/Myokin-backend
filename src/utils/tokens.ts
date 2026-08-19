import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export const signAccessToken = (id: string, role: string) => jwt.sign({ sub: id, role }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' })
export const signRefreshToken = (id: string) => jwt.sign({ sub: id }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' })
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
export const refreshCookie = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/api/auth' }


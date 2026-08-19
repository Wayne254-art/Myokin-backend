import type { ErrorRequestHandler } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

export class AppError extends Error { constructor(public status: number, message: string) { super(message) } }
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ success: false, message: 'Please check the information provided.', errors: error.flatten() })
  if (error instanceof AppError) return res.status(error.status).json({ success: false, message: error.message })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ success: false, message: 'That record already exists.' })
  console.error(error)
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' })
}


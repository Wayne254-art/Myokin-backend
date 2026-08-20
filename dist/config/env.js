import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(5000),
    DATABASE_URL: z.string().min(1),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_CALLBACK_URL: z.string().url().optional(),
});
export const env = schema.parse(process.env);

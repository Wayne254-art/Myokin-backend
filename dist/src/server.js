import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
const server = app.listen(env.PORT, () => console.log(`MYOKIN API listening on http://localhost:${env.PORT}`));
const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

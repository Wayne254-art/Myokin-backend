import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./utils/errors.js";
import { optionalAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { cartRouter, wishlistRouter } from "./routes/cart.js";
import { ordersRouter } from "./routes/orders.js";
import { paymentsRouter } from "./routes/payments.js";
import { contentRouter } from "./routes/content.js";
import { adminRouter } from "./routes/admin.js";
import { accountRouter } from "./routes/account.js";
export const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
    origin: env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    // The storefront sends this anonymous-session identifier with cart requests.
    // It must be listed in the preflight response before a browser may send it.
    allowedHeaders: ["Content-Type", "Authorization", "X-Session-Id"],
}));
app.use(rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
}));
app.use(express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
        req.rawBody = buffer;
    },
}));
app.use(cookieParser());
app.use(optionalAuth);
app.get("/api/health", (_req, res) => res.json({
    success: true,
    data: { service: "myokin-api", status: "healthy" },
}));
app.use("/api/auth", authRouter);
app.use("/api", catalogRouter);
app.use("/api/cart", cartRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/account", accountRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api", contentRouter);
app.use("/api/admin", adminRouter);
app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found." }));
app.use(errorHandler);

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async.js";
import { AppError } from "../utils/errors.js";
import {
  calculateDelivery,
  calculateDiscount,
  calculateTax,
  calculateTotal,
} from "../services/pricing.js";

export const ordersRouter = Router();
ordersRouter.use(authenticate);
const requiredText = (label: string, min: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required and must be at least ${min} characters.`);
const address = z.object({
  firstName: requiredText("First name", 2),
  lastName: requiredText("Last name", 2),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(
      z
        .string()
        .regex(
          /^(?:\+?254|0)[17]\d{8}$/,
          "Enter a valid mobile number beginning with 01 or 07, e.g. 0111 239 949."
        )
    ),
  county: requiredText("County", 2),
  town: requiredText("Town or locality", 2),
  addressLine1: requiredText("Street, building or house address", 5),
  landmark: z
    .string()
    .trim()
    .max(120, "Landmark must be 120 characters or fewer.")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(500, "Delivery notes must be 500 characters or fewer.")
    .optional(),
});
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        address,
        deliveryZoneId: z.string().optional(),
        fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]).default("DELIVERY"),
        couponCode: z.string().optional(),
        paymentMethod: z.literal("PAYSTACK"),
      })
      .parse(req.body);
    const fulfilmentMethod =
      input.deliveryZoneId === "PICKUP" ? "PICKUP" : input.fulfilmentMethod;
    const cart = await prisma.cart.findFirst({
      where: { userId: req.user!.id },
      include: {
        items: {
          include: {
            product: { include: { images: { take: 1 } } },
            variant: true,
          },
        },
      },
    });
    if (!cart?.items.length)
      throw new AppError(400, "Your beauty bag is empty.");
    const zone =
      input.deliveryZoneId &&
      input.deliveryZoneId !== "PICKUP" &&
      input.deliveryZoneId !== "BASE_DELIVERY"
        ? await prisma.deliveryZone.findFirst({
            where: { id: input.deliveryZoneId, isActive: true },
          })
        : null;
    if (
      input.deliveryZoneId &&
      input.deliveryZoneId !== "PICKUP" &&
      input.deliveryZoneId !== "BASE_DELIVERY" &&
      !zone
    )
      throw new AppError(400, "That delivery area is not currently available.");
    const subtotal = cart.items.reduce(
      (sum, item) => sum + Number(item.unitPrice) * item.quantity,
      0
    );
    let coupon: Awaited<ReturnType<typeof prisma.coupon.findFirst>> = null;
    if (input.couponCode) {
      const now = new Date();
      coupon = await prisma.coupon.findUnique({
        where: { code: input.couponCode.toUpperCase() },
      });
      if (!coupon) throw new AppError(400, "Invalid coupon.");
      if (
        !coupon.isActive ||
        (coupon.startsAt && coupon.startsAt > now) ||
        (coupon.expiresAt && coupon.expiresAt < now) ||
        (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit)
      )
        throw new AppError(400, "Expired coupon.");
      if (coupon.minimumSpend && subtotal < Number(coupon.minimumSpend))
        throw new AppError(
          400,
          `This coupon requires a minimum spend of KSh ${Number(
            coupon.minimumSpend
          ).toLocaleString()}.`
        );
    }
    const couponId = coupon?.id;
    const discount = calculateDiscount(
      subtotal,
      coupon && {
        type: coupon.type,
        value: Number(coupon.value),
        minimumSpend:
          coupon.minimumSpend == null ? null : Number(coupon.minimumSpend),
        maximumDiscount:
          coupon.maximumDiscount == null
            ? null
            : Number(coupon.maximumDiscount),
      }
    );
    const settings = await prisma.storeSetting.findUnique({
      where: { id: "store" },
    });
    const deliveryFee =
      fulfilmentMethod === "PICKUP"
        ? 0
        : zone
        ? calculateDelivery(
            subtotal,
            Number(zone.fee),
            zone.freeDeliveryThreshold == null
              ? null
              : Number(zone.freeDeliveryThreshold)
          )
        : Number(settings?.defaultDeliveryFee ?? 0);
    const tax = calculateTax(
      subtotal,
      discount,
      Number(settings?.taxRate ?? 0)
    );
    const total = calculateTotal(subtotal, discount, deliveryFee, tax);
    const order = await prisma.$transaction(
      async (tx) => {
        for (const item of cart.items) {
          const stock =
            item.variant?.stockQuantity ?? item.product.stockQuantity;
          if (!item.product.isActive || stock < item.quantity)
            throw new AppError(
              409,
              `${item.product.name} does not have enough stock.`
            );
        }
        const count = await tx.order.count();
        const orderNumber = `MYK-${new Date().getFullYear()}-${String(
          count + 1
        ).padStart(6, "0")}`;
        const deliveryPending = fulfilmentMethod === "DELIVERY" && !zone;
        const created = await tx.order.create({
          data: {
            orderNumber,
            userId: req.user!.id,
            subtotal,
            discount,
            deliveryFee,
            tax,
            total,
            shippingAddress: {
              ...input.address,
              fulfilmentMethod,
              deliveryAreaPending: deliveryPending,
              deliveryZoneName: zone?.name,
            },
            paymentMethod: input.paymentMethod,
            notes: deliveryPending
              ? `${
                  input.address.notes ? `${input.address.notes}\n` : ""
                }Delivery area and final coverage pending administrator approval.`
              : input.address.notes,
            couponId,
            items: {
              create: cart.items.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                productName: item.product.name,
                sku: item.variant?.sku ?? item.product.sku,
                image: item.product.images[0]?.url,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: Number(item.unitPrice) * item.quantity,
              })),
            },
            statusHistory: {
              create: {
                status: "PENDING",
                note: deliveryPending
                  ? "Order received — delivery area pending approval"
                  : fulfilmentMethod === "PICKUP"
                  ? "Order received — shop pickup selected"
                  : "Order received",
              },
            },
          },
          include: { items: true },
        });
        if (couponId)
          await tx.coupon.update({
            where: { id: couponId },
            data: { usageCount: { increment: 1 } },
          });
        return created;
      },
      { isolationLevel: "Serializable" }
    );
    res.status(201).json({ success: true, data: order });
  })
);
ordersRouter.get(
  "/",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await prisma.order.findMany({
        where: { userId: req.user!.id },
        include: {
          items: true,
          statusHistory: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
    })
  )
);
ordersRouter.get(
  "/:orderNumber",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: {
        orderNumber: String(req.params.orderNumber),
        userId: req.user!.id,
      },
      include: {
        items: true,
        payments: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) throw new AppError(404, "Order not found.");
    res.json({ success: true, data: order });
  })
);

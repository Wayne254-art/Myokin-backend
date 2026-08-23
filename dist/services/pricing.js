export const calculateDiscount = (subtotal, coupon) => {
    if (!coupon || subtotal < (coupon.minimumSpend ?? 0))
        return 0;
    const raw = coupon.type === 'PERCENTAGE' ? subtotal * coupon.value / 100 : coupon.value;
    return Math.max(0, Math.min(subtotal, coupon.maximumDiscount == null ? raw : Math.min(raw, coupon.maximumDiscount)));
};
export const calculateDelivery = (subtotal, fee, freeThreshold) => freeThreshold != null && subtotal >= freeThreshold ? 0 : fee;
export const calculateTax = (subtotal, discount, taxRate) => Math.round(Math.max(0, subtotal - discount) * Math.max(0, taxRate)) / 100;
export const calculateTotal = (subtotal, discount, deliveryFee, tax = 0) => Math.max(0, subtotal - discount + deliveryFee + tax);

export type CouponRule = { type: 'PERCENTAGE'|'FIXED_AMOUNT'; value: number; maximumDiscount?: number|null; minimumSpend?: number|null }
export const calculateDiscount = (subtotal:number,coupon?:CouponRule|null) => {
  if (!coupon || subtotal < (coupon.minimumSpend ?? 0)) return 0
  const raw = coupon.type === 'PERCENTAGE' ? subtotal * coupon.value / 100 : coupon.value
  return Math.max(0, Math.min(subtotal, coupon.maximumDiscount == null ? raw : Math.min(raw,coupon.maximumDiscount)))
}
export const calculateDelivery = (subtotal:number,fee:number,freeThreshold?:number|null) => freeThreshold != null && subtotal >= freeThreshold ? 0 : fee
export const calculateTax = (subtotal:number,discount:number,taxRate:number) => Math.round(Math.max(0,subtotal-discount)*Math.max(0,taxRate))/100
export const calculateTotal = (subtotal:number,discount:number,deliveryFee:number,tax=0) => Math.max(0,subtotal-discount+deliveryFee+tax)

import { describe, expect, it } from 'vitest';
import { calculateDelivery, calculateDiscount, calculateTotal } from './pricing.js';
describe('commerce pricing', () => {
    it('caps percentage discounts', () => expect(calculateDiscount(10_000, { type: 'PERCENTAGE', value: 20, maximumDiscount: 1_500 })).toBe(1_500));
    it('never discounts below zero', () => expect(calculateDiscount(1_000, { type: 'FIXED_AMOUNT', value: 5_000 })).toBe(1_000));
    it('honours minimum spend', () => expect(calculateDiscount(900, { type: 'FIXED_AMOUNT', value: 100, minimumSpend: 1_000 })).toBe(0));
    it('provides free delivery at threshold', () => expect(calculateDelivery(5_000, 350, 5_000)).toBe(0));
    it('calculates a KES order total', () => expect(calculateTotal(4_000, 500, 300)).toBe(3_800));
});

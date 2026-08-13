import { describe, it, expect } from "vitest";
import { calculateLineItem, calculateDocumentTotals, CalculationError } from "./calc";

describe("calculateLineItem — sample document from the brief", () => {
  it("Widget A: qty 2 @ 100.00, 10% discount, 5% tax", () => {
    const result = calculateLineItem({
      quantity: 2,
      unitPrice: 100.0,
      discount: { type: "percent", value: 10 },
      taxPercent: 5,
    });
    expect(result.subtotalCents).toBe(20000);
    expect(result.discountCents).toBe(2000);
    expect(result.afterDiscountCents).toBe(18000);
    expect(result.taxCents).toBe(900);
    expect(result.totalCents).toBe(18900);
  });

  it("Widget B: qty 1 @ 50.00, no discount, 5% tax", () => {
    const result = calculateLineItem({ quantity: 1, unitPrice: 50.0, taxPercent: 5 });
    expect(result.subtotalCents).toBe(5000);
    expect(result.discountCents).toBe(0);
    expect(result.afterDiscountCents).toBe(5000);
    expect(result.taxCents).toBe(250);
    expect(result.totalCents).toBe(5250);
  });

  it("Service fee: qty 1 @ 200.00, $20 fixed discount, no tax", () => {
    const result = calculateLineItem({ quantity: 1, unitPrice: 200.0, discount: { type: "fixed", value: 20 } });
    expect(result.subtotalCents).toBe(20000);
    expect(result.discountCents).toBe(2000);
    expect(result.afterDiscountCents).toBe(18000);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(18000);
  });

  it("document totals match the brief's worked example", () => {
    const lines = [
      calculateLineItem({ quantity: 2, unitPrice: 100.0, discount: { type: "percent", value: 10 }, taxPercent: 5 }),
      calculateLineItem({ quantity: 1, unitPrice: 50.0, taxPercent: 5 }),
      calculateLineItem({ quantity: 1, unitPrice: 200.0, discount: { type: "fixed", value: 20 } }),
    ];
    const totals = calculateDocumentTotals(lines);

    expect(totals.subtotalCents).toBe(45000); // 450.00
    expect(totals.discountCents).toBe(4000); // 40.00
    expect(totals.taxCents).toBe(1150); // 11.50
    expect(totals.grandTotalCents).toBe(42150); // 421.50
    expect(totals.subtotalCents - totals.discountCents + totals.taxCents).toBe(totals.grandTotalCents);
  });
});

describe("calculateLineItem — validation", () => {
  it("rejects quantity below 1", () => {
    expect(() => calculateLineItem({ quantity: 0, unitPrice: 10 })).toThrow(CalculationError);
    expect(() => calculateLineItem({ quantity: -1, unitPrice: 10 })).toThrow(CalculationError);
  });

  it("rejects negative unit price", () => {
    expect(() => calculateLineItem({ quantity: 1, unitPrice: -5 })).toThrow(CalculationError);
  });

  it("allows zero unit price (free line item)", () => {
    const result = calculateLineItem({ quantity: 1, unitPrice: 0 });
    expect(result.totalCents).toBe(0);
  });

  it("rejects a discount percent over 100", () => {
    expect(() =>
      calculateLineItem({ quantity: 1, unitPrice: 10, discount: { type: "percent", value: 150 } })
    ).toThrow(CalculationError);
  });

  it("rejects a fixed discount larger than the line subtotal", () => {
    expect(() =>
      calculateLineItem({ quantity: 1, unitPrice: 10, discount: { type: "fixed", value: 50 } })
    ).toThrow(/cannot exceed/);
  });

  it("allows a fixed discount equal to the line subtotal", () => {
    const result = calculateLineItem({ quantity: 1, unitPrice: 10, discount: { type: "fixed", value: 10 } });
    expect(result.afterDiscountCents).toBe(0);
  });

  it("rejects a tax percent over 100", () => {
    expect(() => calculateLineItem({ quantity: 1, unitPrice: 10, taxPercent: 250 })).toThrow(CalculationError);
  });
});

describe("calculateLineItem — rounding", () => {
  it("rounds tax on an odd after-discount amount half-up", () => {
    const a = calculateLineItem({ quantity: 1, unitPrice: 1.0, taxPercent: 15 });
    expect(a.taxCents).toBe(15);
    const b = calculateLineItem({ quantity: 1, unitPrice: 0.33, taxPercent: 12.5 });
    expect(b.taxCents).toBe(4); // 33 * 0.125 = 4.125 -> rounds to 4
  });

  it("supports fractional quantities", () => {
    const result = calculateLineItem({ quantity: 2.5, unitPrice: 10 });
    expect(result.subtotalCents).toBe(2500);
  });
});

describe("calculateDocumentTotals", () => {
  it("returns zeroed totals for an empty document", () => {
    expect(calculateDocumentTotals([])).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      grandTotalCents: 0,
    });
  });
});

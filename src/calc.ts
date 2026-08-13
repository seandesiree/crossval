
export type Discount =
  | { type: "percent"; value: number } 
  | { type: "fixed"; value: number }; 

export interface LineItemInput {
  quantity: number;
  unitPrice: number; 
  discount?: Discount | null;
  taxPercent?: number | null; 
}

export interface LineItemResult {
  subtotalCents: number;
  discountCents: number;
  afterDiscountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface DocumentTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  grandTotalCents: number;
}


export class CalculationError extends Error {
  field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = "CalculationError";
    this.field = field;
  }
}

const dollarsToCents = (dollars: number): number => Math.round(dollars * 100);
const roundHalfUp = (cents: number): number => Math.round(cents);

export function calculateLineItem(input: LineItemInput): LineItemResult {
  const { quantity, unitPrice, discount, taxPercent } = input;

  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new CalculationError("Quantity must be at least 1", "quantity");
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new CalculationError("Unit price must be zero or greater", "unitPrice");
  }

  const subtotalCents = roundHalfUp(quantity * dollarsToCents(unitPrice));

  let discountCents = 0;
  if (discount) {
    if (discount.type === "percent") {
      if (!Number.isFinite(discount.value) || discount.value < 0 || discount.value > 100) {
        throw new CalculationError("Discount percent must be between 0 and 100", "discount.value");
      }
      discountCents = roundHalfUp(subtotalCents * (discount.value / 100));
    } else if (discount.type === "fixed") {
      if (!Number.isFinite(discount.value) || discount.value < 0) {
        throw new CalculationError("Fixed discount must be zero or greater", "discount.value");
      }
      discountCents = dollarsToCents(discount.value);
      if (discountCents > subtotalCents) {
        throw new CalculationError(
          "Fixed discount cannot exceed the line subtotal",
          "discount.value"
        );
      }
    } else {
      throw new CalculationError('Discount type must be "percent" or "fixed"', "discount.type");
    }
  }

  const afterDiscountCents = subtotalCents - discountCents;

  let taxCents = 0;
  if (taxPercent != null) {
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      throw new CalculationError("Tax percent must be between 0 and 100", "taxPercent");
    }
    taxCents = roundHalfUp(afterDiscountCents * (taxPercent / 100));
  }

  const totalCents = afterDiscountCents + taxCents;

  return { subtotalCents, discountCents, afterDiscountCents, taxCents, totalCents };
}

export function calculateDocumentTotals(lines: LineItemResult[]): DocumentTotals {
  return lines.reduce(
    (acc, l) => ({
      subtotalCents: acc.subtotalCents + l.subtotalCents,
      discountCents: acc.discountCents + l.discountCents,
      taxCents: acc.taxCents + l.taxCents,
      grandTotalCents: acc.grandTotalCents + l.totalCents,
    }),
    { subtotalCents: 0, discountCents: 0, taxCents: 0, grandTotalCents: 0 }
  );
}

export const centsToDollars = (cents: number): number => Math.round(cents) / 100;


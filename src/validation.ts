import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const discountSchema = z
  .object({
    type: z.enum(["percent", "fixed"]),
    value: z.number(),
  })
  .nullable()
  .optional();

export const lineItemSchema = z.object({
  description: z.string().min(1, "Line item description is required"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  unitPrice: z.number().min(0, "Unit price must be zero or greater"),
  discount: discountSchema,
  taxPercent: z.number().min(0, "Tax percent must be zero or greater").max(100, "Tax percent cannot exceed 100").nullable().optional(),
});

export const lineItemUpdateSchema = lineItemSchema.partial();

export const documentCreateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  customer: z.string().min(1, "Customer is required"),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date must be in YYYY-MM-DD format"),
  lines: z.array(lineItemSchema).optional(),
});

export const documentUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  customer: z.string().min(1, "Customer is required").optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date must be in YYYY-MM-DD format").optional(),
});

export function formatZodError(error: z.ZodError): { error: string; details: { path: string; message: string }[] } {
  const details = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return { error: details[0]?.message ?? "Invalid input", details };
}

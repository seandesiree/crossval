import { Router } from "express";
import { db } from "../db";
import { requireAuth, type AuthedRequest } from "../auth";
import { centsToDollars } from "../calc";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const dateSchema = /^\d{4}-\d{2}-\d{2}$/;

reportsRouter.get("/summary", (req: AuthedRequest, res) => {
  const { from, to } = req.query;

  if (typeof from !== "string" || typeof to !== "string" || !dateSchema.test(from) || !dateSchema.test(to)) {
    return res.status(400).json({ error: "Query params 'from' and 'to' are required, in YYYY-MM-DD format" });
  }
  if (from > to) {
    return res.status(400).json({ error: "'from' date must not be after 'to' date" });
  }

  const row = db
    .prepare(
      `SELECT
         COUNT(DISTINCT d.id) AS document_count,
         COALESCE(SUM(li.total_cents), 0) AS grand_total_cents,
         COALESCE(SUM(li.tax_cents), 0) AS total_tax_cents,
         COALESCE(SUM(li.discount_cents), 0) AS total_discount_cents
       FROM documents d
       LEFT JOIN line_items li ON li.document_id = d.id
       WHERE d.user_id = ? AND d.issue_date >= ? AND d.issue_date <= ?`
    )
    .get(req.user!.userId, from, to) as {
    document_count: number;
    grand_total_cents: number;
    total_tax_cents: number;
    total_discount_cents: number;
  };

  res.json({
    from,
    to,
    documentCount: row.document_count,
    grandTotal: centsToDollars(row.grand_total_cents),
    totalTax: centsToDollars(row.total_tax_cents),
    totalDiscount: centsToDollars(row.total_discount_cents),
  });
});

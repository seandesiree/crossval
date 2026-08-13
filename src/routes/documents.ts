import { Router } from "express";
import { db } from "../db";
import { requireAuth, type AuthedRequest } from "../auth";
import {
  documentCreateSchema,
  documentUpdateSchema,
  lineItemSchema,
  lineItemUpdateSchema,
  formatZodError,
} from "../validation";
import { calculateLineItem, calculateDocumentTotals, CalculationError, centsToDollars, type LineItemInput } from "../calc";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

interface DocumentRow {
  id: number;
  user_id: number;
  title: string;
  customer: string;
  issue_date: string;
  status: "draft" | "finalized";
  created_at: string;
  updated_at: string;
}

interface LineItemRow {
  id: number;
  document_id: number;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_type: "percent" | "fixed" | null;
  discount_value: number | null;
  tax_percent: number | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
}

function getDocumentForUser(id: number, userId: number): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, userId) as
    | DocumentRow
    | undefined;
}

function getLines(documentId: number): LineItemRow[] {
  return db
    .prepare("SELECT * FROM line_items WHERE document_id = ? ORDER BY sort_order ASC, id ASC")
    .all(documentId) as LineItemRow[];
}

function toResults(lines: LineItemRow[]) {
  return lines.map((l) => ({
    subtotalCents: l.subtotal_cents,
    discountCents: l.discount_cents,
    afterDiscountCents: l.subtotal_cents - l.discount_cents,
    taxCents: l.tax_cents,
    totalCents: l.total_cents,
  }));
}

function serializeLine(row: LineItemRow) {
  return {
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: centsToDollars(row.unit_price_cents),
    discount: row.discount_type ? { type: row.discount_type, value: row.discount_value } : null,
    taxPercent: row.tax_percent,
    subtotal: centsToDollars(row.subtotal_cents),
    discountAmount: centsToDollars(row.discount_cents),
    taxAmount: centsToDollars(row.tax_cents),
    total: centsToDollars(row.total_cents),
  };
}

function serializeDocument(doc: DocumentRow, lines: LineItemRow[]) {
  const totals = calculateDocumentTotals(toResults(lines));
  return {
    id: doc.id,
    title: doc.title,
    customer: doc.customer,
    issueDate: doc.issue_date,
    status: doc.status,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    lines: lines.map(serializeLine),
    totals: {
      subtotal: centsToDollars(totals.subtotalCents),
      totalDiscount: centsToDollars(totals.discountCents),
      totalTax: centsToDollars(totals.taxCents),
      grandTotal: centsToDollars(totals.grandTotalCents),
    },
  };
}

function insertLine(documentId: number, sortOrder: number, input: LineItemInput & { description: string }) {
  const calc = calculateLineItem(input);
  db.prepare(
    `INSERT INTO line_items
      (document_id, sort_order, description, quantity, unit_price_cents, discount_type, discount_value, tax_percent,
       subtotal_cents, discount_cents, tax_cents, total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    documentId,
    sortOrder,
    input.description,
    input.quantity,
    Math.round(input.unitPrice * 100),
    input.discount?.type ?? null,
    input.discount?.value ?? null,
    input.taxPercent ?? null,
    calc.subtotalCents,
    calc.discountCents,
    calc.taxCents,
    calc.totalCents
  );
}

function handleCalcError(res: import("express").Response, err: unknown): boolean {
  if (err instanceof CalculationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return true;
  }
  return false;
}

// ---- Documents ----

documentsRouter.get("/", (req: AuthedRequest, res) => {
  const rows = db
    .prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY issue_date DESC, id DESC")
    .all(req.user!.userId) as DocumentRow[];

  const summaries = rows.map((doc) => {
    const lines = getLines(doc.id);
    const totals = calculateDocumentTotals(toResults(lines));
    return {
      id: doc.id,
      title: doc.title,
      customer: doc.customer,
      issueDate: doc.issue_date,
      status: doc.status,
      grandTotal: centsToDollars(totals.grandTotalCents),
      lineCount: lines.length,
    };
  });

  res.json({ documents: summaries });
});

documentsRouter.post("/", (req: AuthedRequest, res) => {
  const parsed = documentCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const { title, customer, issueDate, lines } = parsed.data;

  const insertDoc = db.prepare(
    "INSERT INTO documents (user_id, title, customer, issue_date, status) VALUES (?, ?, ?, ?, 'draft')"
  );

  try {
    const documentId = db.transaction(() => {
      const result = insertDoc.run(req.user!.userId, title, customer, issueDate);
      const id = Number(result.lastInsertRowid);
      (lines ?? []).forEach((line, index) => insertLine(id, index, line));
      return id;
    })();

    const doc = getDocumentForUser(documentId, req.user!.userId)!;
    res.status(201).json(serializeDocument(doc, getLines(documentId)));
  } catch (err) {
    if (!handleCalcError(res, err)) throw err;
  }
});

documentsRouter.get("/:id", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json(serializeDocument(doc, getLines(doc.id)));
});

documentsRouter.patch("/:id", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") return res.status(409).json({ error: "Cannot edit a finalized document" });

  const parsed = documentUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  db.prepare(
    "UPDATE documents SET title = ?, customer = ?, issue_date = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    parsed.data.title ?? doc.title,
    parsed.data.customer ?? doc.customer,
    parsed.data.issueDate ?? doc.issue_date,
    doc.id
  );

  const updated = getDocumentForUser(doc.id, req.user!.userId)!;
  res.json(serializeDocument(updated, getLines(updated.id)));
});

documentsRouter.delete("/:id", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") return res.status(409).json({ error: "Cannot delete a finalized document" });
  db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  res.status(204).send();
});

documentsRouter.post("/:id/finalize", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") return res.status(409).json({ error: "Document is already finalized" });

  const lines = getLines(doc.id);
  if (lines.length === 0) {
    return res.status(400).json({ error: "Cannot finalize a document with no line items" });
  }
  for (const line of lines) {
    if (line.quantity <= 0) {
      return res.status(400).json({ error: `Line "${line.description}" has a non-positive quantity`, field: "quantity" });
    }
    if (line.unit_price_cents < 0) {
      return res.status(400).json({ error: `Line "${line.description}" has a negative unit price`, field: "unitPrice" });
    }
  }

  db.prepare("UPDATE documents SET status = 'finalized', updated_at = datetime('now') WHERE id = ?").run(doc.id);
  const updated = getDocumentForUser(doc.id, req.user!.userId)!;
  res.json(serializeDocument(updated, lines));
});

documentsRouter.post("/:id/duplicate", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const lines = getLines(doc.id);

  const newId = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO documents (user_id, title, customer, issue_date, status) VALUES (?, ?, ?, ?, 'draft')")
      .run(req.user!.userId, `${doc.title} (copy)`, doc.customer, doc.issue_date);
    const id = Number(result.lastInsertRowid);
    lines.forEach((l, index) => {
      db.prepare(
        `INSERT INTO line_items
          (document_id, sort_order, description, quantity, unit_price_cents, discount_type, discount_value, tax_percent,
           subtotal_cents, discount_cents, tax_cents, total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        index,
        l.description,
        l.quantity,
        l.unit_price_cents,
        l.discount_type,
        l.discount_value,
        l.tax_percent,
        l.subtotal_cents,
        l.discount_cents,
        l.tax_cents,
        l.total_cents
      );
    });
    return id;
  })();

  const created = getDocumentForUser(newId, req.user!.userId)!;
  res.status(201).json(serializeDocument(created, getLines(newId)));
});

// ---- Line items ----

documentsRouter.post("/:id/lines", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") {
    return res.status(409).json({ error: "Cannot add line items to a finalized document" });
  }

  const parsed = lineItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  try {
    const nextSortOrder = getLines(doc.id).length;
    insertLine(doc.id, nextSortOrder, parsed.data);
    db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(doc.id);
    const updated = getDocumentForUser(doc.id, req.user!.userId)!;
    res.status(201).json(serializeDocument(updated, getLines(doc.id)));
  } catch (err) {
    if (!handleCalcError(res, err)) throw err;
  }
});

documentsRouter.patch("/:id/lines/:lineId", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") {
    return res.status(409).json({ error: "Cannot edit line items on a finalized document" });
  }

  const existing = db
    .prepare("SELECT * FROM line_items WHERE id = ? AND document_id = ?")
    .get(Number(req.params.lineId), doc.id) as LineItemRow | undefined;
  if (!existing) return res.status(404).json({ error: "Line item not found" });

  const parsed = lineItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const merged = {
    description: parsed.data.description ?? existing.description,
    quantity: parsed.data.quantity ?? existing.quantity,
    unitPrice: parsed.data.unitPrice ?? centsToDollars(existing.unit_price_cents),
    discount:
      parsed.data.discount !== undefined
        ? parsed.data.discount
        : existing.discount_type
          ? { type: existing.discount_type, value: existing.discount_value! }
          : null,
    taxPercent: parsed.data.taxPercent !== undefined ? parsed.data.taxPercent : existing.tax_percent,
  };

  try {
    const calc = calculateLineItem(merged);
    db.prepare(
      `UPDATE line_items SET description = ?, quantity = ?, unit_price_cents = ?, discount_type = ?, discount_value = ?,
       tax_percent = ?, subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ? WHERE id = ?`
    ).run(
      merged.description,
      merged.quantity,
      Math.round(merged.unitPrice * 100),
      merged.discount?.type ?? null,
      merged.discount?.value ?? null,
      merged.taxPercent ?? null,
      calc.subtotalCents,
      calc.discountCents,
      calc.taxCents,
      calc.totalCents,
      existing.id
    );
    db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(doc.id);
    const updated = getDocumentForUser(doc.id, req.user!.userId)!;
    res.json(serializeDocument(updated, getLines(doc.id)));
  } catch (err) {
    if (!handleCalcError(res, err)) throw err;
  }
});

documentsRouter.delete("/:id/lines/:lineId", (req: AuthedRequest, res) => {
  const doc = getDocumentForUser(Number(req.params.id), req.user!.userId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status === "finalized") {
    return res.status(409).json({ error: "Cannot remove line items from a finalized document" });
  }

  const existing = db
    .prepare("SELECT id FROM line_items WHERE id = ? AND document_id = ?")
    .get(Number(req.params.lineId), doc.id);
  if (!existing) return res.status(404).json({ error: "Line item not found" });

  db.prepare("DELETE FROM line_items WHERE id = ?").run(Number(req.params.lineId));
  db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(doc.id);
  const updated = getDocumentForUser(doc.id, req.user!.userId)!;
  res.json(serializeDocument(updated, getLines(doc.id)));
});

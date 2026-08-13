# Multi-Rate Pricing Calculator

A small web app for creating documents with line items, applying per-line discounts and
tax, and computing totals server-side.

## Stack

- **Backend:** Node.js + TypeScript + Express + SQLite (`better-sqlite3`)
- **Auth:** email/password with bcrypt hashing, JWT bearer tokens
- **Validation:** Zod schemas at the API boundary
- **Frontend:** plain HTML/CSS/vanilla JS, served statically by Express
- **Tests:** Vitest, unit tests on the calculation module

## Prerequisites & setup

```bash
npm install
npm test        # runs the calculation module unit tests
npm run dev      # starts the API + frontend at http://localhost:3001
```

No external database required — SQLite creates `data/app.db` automatically on first
run. Override with `PORT` / `DB_PATH` / `JWT_SECRET` env vars if needed.

## Calculation & rounding policy

All money is stored and computed as **integer cents**, never floats, to avoid
floating-point drift (`0.1 + 0.2` isn't exactly `0.3` in binary floating point, and that
error compounds across discount/tax math). Dollar amounts only exist at the API's JSON
boundary; the database and calculation module work in cents throughout.

**Rounding policy: round half-up to the nearest cent, applied at each step, per line.**

For each line item, in order:

1. `subtotalCents = round(quantity × unitPriceCents)`
2. Discount — percent: `discountCents = round(subtotalCents × percent / 100)`; fixed:
   `discountCents = round(fixedDollars × 100)`
3. `afterDiscountCents = subtotalCents − discountCents`
4. `taxCents = round(afterDiscountCents × taxPercent / 100)` — **tax is computed on the
   discounted amount, not the original subtotal**
5. `totalCents = afterDiscountCents + taxCents`

Document totals are a flat sum of the already-rounded per-line cents values, never
recomputed from rounded dollar totals — that would introduce drift across N lines.

### Worked example (from the assignment brief)

| Line | Qty | Unit price | Discount | Tax | Subtotal | Discount amt | After discount | Tax amt | Line total |
|---|---|---|---|---|---|---|---|---|---|
| Widget A | 2 | 100.00 | 10% | 5% | 200.00 | 20.00 | 180.00 | 9.00 | 189.00 |
| Widget B | 1 | 50.00 | — | 5% | 50.00 | 0.00 | 50.00 | 2.50 | 52.50 |
| Service fee | 1 | 200.00 | $20 fixed | — | 200.00 | 20.00 | 180.00 | 0.00 | 180.00 |

Document totals: subtotal **450.00**, total discount **40.00**, total tax **11.50**,
grand total **421.50**. Verified against `src/calc.test.ts` and against a live run of the
API (created this exact document via the running server and confirmed the response
matched).

### Policy choices

- **Fixed discount exceeding the line subtotal is rejected, not clamped** — gives a
  specific error (`"Fixed discount cannot exceed the line subtotal"`) instead of
  silently changing what the user typed.
- **Percent or fixed discount, never both, enforced by the type system**: a line's
  discount is `{ type: "percent" | "fixed", value }`, a tagged union rather than two
  separate optional fields — "both at once" isn't representable.
- **Quantity must be ≥ 1**, enforced on every create/update. The finalize endpoint also
  re-checks quantity/price on every line as a safety net.
- **Half-up rounding** rather than banker's rounding, matching the brief's worked
  example.

## Finalize / immutability rules

- Documents are created as `draft`.
- While `draft`: title, customer, issue date, and line items are fully editable.
- `POST /api/documents/:id/finalize` transitions to `finalized`. Requires at least one
  line item and re-validates every line's quantity/price.
- Once `finalized`, every mutating endpoint on that document rejects with `409` and a
  specific error — enforced in each route handler, not just hidden in the UI.
- **Duplicate (stretch goal): implemented.** `POST /api/documents/:id/duplicate` copies
  any document into a new `draft`, the only way to get an editable version of a
  finalized document's contents.
- Deleting a document is only allowed in `draft` status — a finalized document is meant
  to behave like an issued invoice; corrections go through duplicate-and-revise.
- **Printable view (stretch goal): implemented.** A "Print / Save PDF" button renders a
  clean, non-editable view of the document into a hidden container shown only under a
  `@media print` CSS rule, then calls `window.print()`. This reuses data already fetched
  for the detail view rather than adding a server endpoint that would need to
  authenticate a plain browser navigation.

## Validation

Zod schemas validate request bodies at the route layer. The calculation module does a
second pass on the actual numbers (quantity ≥ 1, price ≥ 0, discount/tax percent 0–100,
fixed discount ≤ subtotal) and throws a typed `CalculationError` with a `field` name,
which routes map to a `400` with a specific message.

## Reporting

`GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` sums `total_cents`,
`discount_cents`, and `tax_cents` directly from the `line_items` table for the current
user's documents in that issue-date range. Because it reads the same per-line values
every document detail view reads, the report can't drift out of sync with individual
documents.

## Assumptions & tradeoffs

- Auth is minimal (bcrypt + JWT, 7-day expiry, no refresh/reset flow) — fine for this
  scope, not production-ready.
- No pagination on document/line lists — acceptable at small scale.
- SQLite (`better-sqlite3`, synchronous) keeps the app dependency-free and easy to run
  locally; a production version would likely move to Postgres for concurrent-write
  safety and proper migrations.
- Frontend is plain JS/no framework — the calculation module and API design are what's
  being exercised here, not frontend tooling.

## What I'd improve before production

- Real migrations tool instead of `CREATE TABLE IF NOT EXISTS` at startup.
- Rate limiting / account lockout on login.
- Idempotency keys on line-item mutations.
- Structured logging and request IDs.
- Move off a single JWT secret / synchronous SQLite to something that survives more
  than one server process.

## Manual verification performed

In addition to `npm test` (14 passing unit tests on the calculation module):

- Created the brief's exact sample document via the running API and confirmed the
  response matched its table exactly (subtotal 450.00, discount 40.00, tax 11.50, grand
  total 421.50).
- Finalized the document, then confirmed editing it returns `409` with a clear error.
- Confirmed a fixed discount larger than its line's subtotal is rejected with a specific
  error.
- Confirmed the summary report over the document's issue-date range matches the
  document's own totals.

## Deployment

Live URL: _TODO — add once deployed._

/**
 * T-2.PROC.04 — the comparative statement matrix, its stated basis and its export.
 *
 * A buyers' comparison, not a second database: this module holds **no** fetching and
 * no state. `buildComparison` turns one RFQ as the API states it (T-2.PROC.03's
 * `/api/v1/rfqs/{number}`) into rows a person can read across suppliers, and
 * `comparisonCsv` writes the same thing out. Two rules it is built around:
 *
 * **The basis is stated, never implied.** Quotes arrived in whatever currency each
 * supplier names, so the comparison is made in one currency, converted at one
 * dated rate, and — where the pack configures a procurement tax rate — inclusive of
 * it. All of that is carried in `basis` and printed on the export, because a
 * comparison whose basis has to be guessed is not a justification.
 *
 * **Money is exact.** Amounts arrive and leave as decimal **strings** (the platform
 * rule); nothing here ever touches `Number`. The tax-inclusive figure and the
 * extended total are computed in scaled integer arithmetic and rounded half-up at
 * the money scale, so a cent is never invented by binary floating point.
 *
 * What it deliberately does not do: choose a winner (T-2.PROC.05) or judge whether a
 * late quote should be used — it only reports the flag.
 */

import type { components } from "./contract";

export type RfqView = components["schemas"]["RfqOut"];
export type RfqSupplierView = components["schemas"]["RfqSupplierOut"];
export type RfqBasisView = components["schemas"]["RfqBasisOut"];

/** The platform's money scale: six decimal places. */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

/** A decimal string as an integer of 10^-6 units — the only way money is handled. */
function scaled(value: string): bigint {
  const text = value.trim();
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const digits = `${whole === "" ? "0" : whole}${fraction.padEnd(SCALE, "0").slice(0, SCALE)}`;
  const units = BigInt(digits.replace(/[^0-9]/g, "") || "0");
  return negative ? -units : units;
}

/** 10^-6 units back to a decimal string at the money scale. */
function decimal(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, "0");
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function round(units: bigint, divisor: bigint): bigint {
  // Half-up, on the absolute value, so a negative total is not rounded away from
  // zero differently from a positive one.
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const rounded = (magnitude + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/** `a × b`, both decimal strings, at the money scale. */
export function multiply(a: string, b: string): string {
  return decimal(round(scaled(a) * scaled(b), FACTOR));
}

/** An amount with the configured rate added on top, exactly: `a × (1 + rate/100)`. */
export function taxInclusive(
  amount: string,
  ratePercent: string | null | undefined,
): string {
  if (ratePercent == null) {
    return decimal(scaled(amount));
  }
  // 1 + rate/100, retaining the contract's full six-decimal percentage scale.
  const rateScale = 100n * FACTOR;
  return decimal(round(scaled(amount) * (rateScale + scaled(ratePercent)), rateScale));
}

/** The one line of prose that says what the numbers below it are comparable at. */
export function basisLabel(basis: RfqBasisView): string {
  const parts = [`Amounts in ${basis.base_currency}, converted at the rate for ${basis.fx_on}`];
  if (basis.tax_inclusive && basis.tax_rate_percent != null) {
    const rule = basis.tax_rule_code ? ` ${basis.tax_rule_code}` : "";
    parts.push(`tax-inclusive at ${basis.tax_rate_percent}%${rule}`);
  } else {
    parts.push("tax-exclusive (no procurement tax rate is configured)");
  }
  parts.push("one row per supplier per line");
  return parts.join(" — ");
}

/** What one supplier said about one line — or that they said nothing about it. */
export interface ComparisonCell {
  supplier: string;
  /** quoted | no_quote (answered, silent on this line) | did_not_respond. */
  status: "quoted" | "no_quote" | "did_not_respond";
  currency: string | null;
  quotedUnitPrice: string | null;
  baseUnitPrice: string | null;
  taxInclusiveUnitPrice: string | null;
  /** tax-inclusive unit price × the quantity asked for. */
  extended: string | null;
  late: boolean;
  leadTimeDays: number | null;
  validUntil: string | null;
}

export interface ComparisonRow {
  lineNo: number;
  description: string;
  quantity: string;
  uom: string;
  cells: ComparisonCell[];
}

export interface Comparison {
  rfq: string;
  requisition: string;
  basis: RfqBasisView;
  label: string;
  suppliers: string[];
  nonResponders: string[];
  lateResponders: string[];
  rows: ComparisonRow[];
}

function cellFor(
  supplier: RfqSupplierView,
  lineNo: number,
  quantity: string,
  ratePercent: string | null,
): ComparisonCell {
  const quote = supplier.lines.find((line) => line.line_no === lineNo);
  const common = {
    supplier: supplier.code,
    late: supplier.late,
    leadTimeDays: supplier.lead_time_days ?? null,
    validUntil: supplier.valid_until ?? null,
  };
  if (!supplier.responded) {
    return {
      ...common,
      status: "did_not_respond",
      currency: null,
      quotedUnitPrice: null,
      baseUnitPrice: null,
      taxInclusiveUnitPrice: null,
      extended: null,
    };
  }
  if (quote === undefined) {
    // Answered, but not about this line — which is not the same as quoting zero,
    // and a comparison that conflated them would misread a silent supplier as a
    // free one.
    return {
      ...common,
      status: "no_quote",
      currency: null,
      quotedUnitPrice: null,
      baseUnitPrice: null,
      taxInclusiveUnitPrice: null,
      extended: null,
    };
  }
  const inclusive = taxInclusive(quote.base_unit_price, ratePercent);
  return {
    ...common,
    status: "quoted",
    currency: quote.currency,
    quotedUnitPrice: quote.unit_price,
    baseUnitPrice: quote.base_unit_price,
    taxInclusiveUnitPrice: inclusive,
    extended: multiply(inclusive, quantity),
  };
}

export function buildComparison(rfq: RfqView): Comparison {
  const rate = rfq.basis.tax_inclusive ? (rfq.basis.tax_rate_percent ?? null) : null;
  const rows = rfq.lines.map((line) => ({
    lineNo: line.line_no,
    description: line.description,
    quantity: line.quantity,
    uom: line.uom,
    cells: rfq.suppliers.map((supplier) =>
      cellFor(supplier, line.line_no, line.quantity, rate),
    ),
  }));
  return {
    rfq: rfq.number,
    requisition: rfq.requisition,
    basis: rfq.basis,
    label: basisLabel(rfq.basis),
    suppliers: rfq.suppliers.map((supplier) => supplier.code),
    nonResponders: rfq.suppliers.filter((s) => !s.responded).map((s) => s.code),
    lateResponders: rfq.suppliers.filter((s) => s.late).map((s) => s.code),
    rows,
  };
}

const CSV_HEADER = [
  "rfq",
  "requisition",
  "line_no",
  "description",
  "quantity",
  "uom",
  "supplier",
  "status",
  "currency",
  "quoted_unit_price",
  "base_unit_price",
  "tax_inclusive_unit_price",
  "extended_tax_inclusive",
  "lead_time_days",
  "valid_until",
  "late",
  "basis",
];

function field(value: string | number | boolean | null, numeric = false): string {
  if (value === null) {
    return "";
  }
  const text =
    !numeric && typeof value === "string" && /^[=+\-@]/.test(value)
      ? `'${value}`
      : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The matrix as CSV — **long** form, one row per supplier per line, with the basis
 * on every row. Long form because it is the shape a spreadsheet pivots from
 * without guessing, and a basis repeated per row because an exported comparison
 * that loses its basis is worse than no export.
 */
export function comparisonCsv(comparison: Comparison): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of comparison.rows) {
    for (const cell of row.cells) {
      lines.push(
        [
          comparison.rfq,
          comparison.requisition,
          row.lineNo,
          row.description,
          row.quantity,
          row.uom,
          cell.supplier,
          cell.status,
          cell.currency,
          cell.quotedUnitPrice,
          cell.baseUnitPrice,
          cell.taxInclusiveUnitPrice,
          cell.extended,
          cell.leadTimeDays,
          cell.validUntil,
          cell.late,
          comparison.label,
        ]
          .map((value, index) =>
            field(value, [2, 4, 9, 10, 11, 12, 13].includes(index)),
          )
          .join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

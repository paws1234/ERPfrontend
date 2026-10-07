/**
 * The POS till — the endpoints it speaks, and the arithmetic it shows.
 *
 * A till is mostly presentation, but three parts of it are logic worth stating once
 * and testing rather than repeating inside a component (tests/pos.test.ts):
 *
 * * **Money is exact.** Every amount the API states is a decimal **string** at the
 *   platform's six-decimal scale, and it is read, summed and printed through scaled
 *   integers, never through `Number` — `0.1 + 0.2` is not `0.3` in binary floating
 *   point, and a till's change is not the place to discover that. A string that is not
 *   an amount reads as `null`, never as zero: `Number("")` is `0`, which would let a
 *   customer be handed goods against a tender nobody actually took.
 * * **The receipt is an open object.** The contract states it as one
 *   (`PosReceiptOut.receipt: {[key: string]: unknown}`), so the till reads it as one:
 *   `receiptRows` labels whatever the API actually sent, keeps every amount exact, and
 *   says a value is not an amount rather than inventing one. The Z-report is stated the
 *   same way, and `reportRows` reads it through the same reader.
 * * **A tender the till cannot read does not settle a sale.** `summariseTenders` adds
 *   the readable tenders up exactly and reports the unreadable ones apart, because a
 *   sale that looks paid when a figure was unreadable is worse than one that looks
 *   unpaid.
 *
 * Every call goes through `request()` in ./api, so a 401, a 403 and a domain refusal
 * arrive as the same three types the shell already branches on, and the actor each
 * write records is the instance's own (`instanceIdentity()`), never the browser's.
 */

// The `.ts` extension is deliberate: the arithmetic below is what tests/pos.test.ts
// states, and Node resolves that test's TypeScript imports by path alone — an
// extensionless `./api` would typecheck and then fail to load under `node --test`.
import { request, type Identity } from "./api.ts";
import type { components } from "./contract";

export type PosSale = components["schemas"]["PosSaleOut"];
export type PosLine = components["schemas"]["PosLineOut"];
export type PosTender = components["schemas"]["PosTenderOut"];
export type PosShift = components["schemas"]["PosShiftOut"];
export type DrawerMovement = components["schemas"]["DrawerMovementOut"];
export type Company = components["schemas"]["CompanyOut"];
/** The receipt, as the contract states it: an open object of whatever the API sent. */
export type Receipt = components["schemas"]["PosReceiptOut"]["receipt"];
/** A Z-report, stated the same way — a nested object of decimal strings. */
export type ZReport = components["schemas"]["PosReportOut"]["report"];

/** The three ways a sale is paid for, as the domain states them. */
export const TENDER_TYPES = ["cash", "card", "gateway"] as const;
export type TenderType = (typeof TENDER_TYPES)[number];

/** The two ways the drawer moves outside a sale. */
export const MOVEMENT_TYPES = ["paid_in", "paid_out"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * The platform's money scale: six decimal places (DOMAIN-MODELS.md §2).
 *
 * A decimal string is what the API states money as; nothing here ever goes through
 * `Number`, and a fraction longer than this scale is refused rather than truncated —
 * the contract states six, so a seventh is drift and dropping it silently would be the
 * same class of loss as reaching for `Number` in the first place.
 */
const SCALE = 6;
const DECIMAL = /^-?\d+(\.\d{1,6})?$/;
/**
 * How the platform *states* money: a decimal string at the money scale, e.g.
 * `12.500000`. A run of digits with no fraction is not that — a barcode, a terminal
 * numbered `1`, a sale number or a reference are all text in the contract, and printing
 * a barcode as `4000000000017.000000` would state a figure nobody wrote.
 */
const STATED = /^-?\d+\.\d{1,6}$/;

/** An amount the till can add up: the text it arrived as, and its exact 10^-6 units. */
export interface Money {
  /** The amount at the platform's money scale, e.g. `12.500000`. */
  text: string;
  /** The same amount in 10^-6 units — the only way a total is summed. */
  units: bigint;
}

/** 10^-6 units back to a decimal string at the money scale. */
function decimal(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}

/** A value the API sent as an amount, or `null` when it is not one. */
export function amount(value: unknown): Money | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const units = BigInt(`${whole === "" ? "0" : whole}${fraction.padEnd(SCALE, "0")}`);
  return { text: decimal(negative ? -units : units), units: negative ? -units : units };
}

/** How an amount reads when the API stated something the till cannot read as money. */
export function amountLabel(money: Money | null): string {
  return money === null ? "not an amount" : money.text;
}

export function isTenderType(text: string): text is TenderType {
  return (TENDER_TYPES as readonly string[]).includes(text);
}

export function isMovementType(text: string): text is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(text);
}

/** The sale's own figures, each exact where the API stated a readable one. */
export interface SaleTotals {
  net: Money | null;
  tax: Money | null;
  total: Money | null;
  tendered: Money | null;
  change: Money | null;
}

export function saleTotals(sale: PosSale): SaleTotals {
  return {
    net: amount(sale.net),
    tax: amount(sale.tax),
    total: amount(sale.total),
    tendered: amount(sale.tendered),
    change: amount(sale.change),
  };
}

/**
 * How the change reads.
 *
 * The sale states the amount; this only puts it in words, and says which side of zero
 * it is on rather than printing a signed figure at a customer — a negative change is an
 * under-tendered sale, which the till must not dress up as a rounding of zero.
 */
export function changeDisplay(change: Money | null): string {
  if (change === null) {
    return "change not an amount";
  }
  if (change.units === 0n) {
    return "no change due";
  }
  return change.units > 0n ? `change due ${change.text}` : `short by ${decimal(-change.units)}`;
}

/** One tender type's place in a sale. */
export interface TenderLine {
  tenderType: string;
  /** How many tenders of this type the sale holds. */
  count: number;
  /** Exact sums over the readable tenders of this type. */
  tendered: Money;
  applied: Money;
  /** Tenders of this type whose amounts the till cannot read — never counted as zero. */
  invalid: number;
}

export interface TenderSummary {
  byType: TenderLine[];
  tendered: Money;
  applied: Money;
  /** The sale's total, when it states a readable one. */
  total: Money | null;
  /** `total − applied`: what is still owed. Negative once more was taken than was due. */
  owed: Money | null;
  /** Tenders whose amounts the till cannot read, on the sale as a whole. */
  invalid: number;
  /** True only when there is something to pay, the total is known, every tender is
   *  readable, and they cover it. */
  settled: boolean;
}

/**
 * What the sale's tenders add up to, exactly.
 *
 * A tender whose `tendered` or `applied` is not an amount is counted as **invalid** and
 * contributes to nothing: half a tender is not a tender, and counting its readable half
 * would understate what was handed over while looking complete.
 */
export function summariseTenders(sale: PosSale): TenderSummary {
  const lines: TenderLine[] = [];
  const byType = new Map<string, TenderLine>();
  let invalid = 0;

  for (const tender of sale.tenders) {
    let line = byType.get(tender.tender_type);
    if (line === undefined) {
      line = {
        tenderType: tender.tender_type,
        count: 0,
        tendered: zero(),
        applied: zero(),
        invalid: 0,
      };
      byType.set(tender.tender_type, line);
      lines.push(line);
    }
    line.count += 1;

    const tendered = amount(tender.tendered);
    const applied = amount(tender.applied);
    if (tendered === null || applied === null) {
      line.invalid += 1;
      invalid += 1;
      continue;
    }
    line.tendered = sum(line.tendered, tendered);
    line.applied = sum(line.applied, applied);
  }

  const applied = sum(...lines.map((line) => line.applied));
  const total = amount(sale.total);

  return {
    byType: lines,
    tendered: sum(...lines.map((line) => line.tendered)),
    applied,
    total,
    owed: total === null ? null : sum(total, negate(applied)),
    invalid,
    // A basket with nothing on it is worth nothing, and nothing is not paid: `0 >= 0`
    // would call an empty till roll settled. The domain refuses to complete a sale
    // worth nothing, so a total of zero is a sale that has not started.
    settled:
      total !== null && total.units > 0n && invalid === 0 && applied.units >= total.units,
  };
}

/** 10^-6 units as a `Money`, so a total is built the one way. */
function money(units: bigint): Money {
  return { text: decimal(units), units };
}

function zero(): Money {
  return money(0n);
}

/** Amounts added exactly, at the money scale. */
function sum(...amounts: Money[]): Money {
  return money(amounts.reduce((units, item) => units + item.units, 0n));
}

function negate(item: Money): Money {
  return money(-item.units);
}

/**
 * Whether the sale still takes scans and tenders.
 *
 * The contract states `status` as a plain string, so this is the till's reading of the
 * two endings the API's own routes name (`complete`, `void`) and not a domain rule: the
 * backend refuses a scan or a tender on a sale it has already closed, and that refusal
 * is what the till shows.
 */
export function isOpen(sale: PosSale): boolean {
  return sale.status !== "completed" && sale.status !== "void";
}

/** One line of a receipt or a Z-report: what the API called it and what it said. */
export type AmountRow =
  | { label: string; kind: "amount"; value: Money }
  | { label: string; kind: "text"; text: string }
  | { label: string; kind: "empty" };

/**
 * The receipt's own totals, in the order a slip reads them.
 *
 * The receipt is an open object, so its keys arrive in whatever order the backend
 * assembled them; a slip whose total stands above its net is not one anybody reads.
 * These five are hoisted when the receipt states them; everything else follows in the
 * order it arrived, with nested objects and lines as dotted labels.
 */
const RECEIPT_TOTALS = ["net", "tax", "total", "tendered", "change"];

export function receiptRows(receipt: Receipt): AmountRow[] {
  const keys = Object.keys(receipt);
  const leading = RECEIPT_TOTALS.filter((name) => keys.includes(name));
  const rest = keys.filter((name) => !RECEIPT_TOTALS.includes(name));
  return [...leading, ...rest].flatMap((key) => flatten(receipt[key], key));
}

/** A Z-report's lines, in the order the API stated them. */
export function reportRows(report: ZReport): AmountRow[] {
  return Object.entries(report).flatMap(([key, value]) => flatten(value, key));
}

function flatten(value: unknown, label: string): AmountRow[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${label}.${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      flatten(item, `${label}.${key}`),
    );
  }
  const money = typeof value === "string" && STATED.test(value.trim()) ? amount(value) : null;
  if (money !== null) {
    return [{ label, kind: "amount", value: money }];
  }
  if (typeof value === "string") {
    return value.trim() === ""
      ? [{ label, kind: "empty" }]
      : [{ label, kind: "text", text: value }];
  }
  if (value === null || value === undefined) {
    return [{ label, kind: "empty" }];
  }
  // A number is not the contract's money: printing it as an amount would claim a scale
  // it was never sent in, so it is shown as the text that arrived.
  return [{ label, kind: "text", text: String(value) }];
}

/** Ring up a sale: which till, which location, and for whom (if anybody). */
export interface NewSale {
  number: string;
  terminal: string;
  locationCode: string;
  customerCode?: string;
  currency?: string;
  /** An ISO date (`YYYY-MM-DD`); the shop's own day when unstated. */
  soldOn?: string;
}

export function openSale(identity: Identity, sale: NewSale): Promise<PosSale> {
  return request<PosSale>("/api/v1/pos/sales", identity, {
    method: "POST",
    body: JSON.stringify({
      number: sale.number,
      terminal: sale.terminal,
      location_code: sale.locationCode,
      customer_code: sale.customerCode,
      currency: sale.currency,
      sold_on: sale.soldOn,
    }),
  });
}

/** One code onto an open sale, with the shelf price it is discounted from. */
export interface ScannedItem {
  barcode: string;
  /** The shelf price, as the decimal string the API states money in. */
  basePrice: string;
  quantity?: string;
  uom?: string;
  campaign?: string;
}

export function scanItem(
  identity: Identity,
  number: string,
  item: ScannedItem,
): Promise<PosSale> {
  return request<PosSale>(`/api/v1/pos/sales/${encodeURIComponent(number)}/scan`, identity, {
    method: "POST",
    body: JSON.stringify({
      barcode: item.barcode,
      base_price: item.basePrice,
      quantity: item.quantity,
      uom: item.uom,
      campaign: item.campaign,
    }),
  });
}

/** One payment taken against a sale. */
export interface NewTender {
  tenderType: TenderType;
  amount: string;
  reference?: string;
}

export function takeTender(
  identity: Identity,
  number: string,
  tender: NewTender,
): Promise<PosSale> {
  return request<PosSale>(`/api/v1/pos/sales/${encodeURIComponent(number)}/tender`, identity, {
    method: "POST",
    body: JSON.stringify({
      tender_type: tender.tenderType,
      amount: tender.amount,
      reference: tender.reference,
    }),
  });
}

/** Complete a sale — this is the step that issues stock and posts it. */
export function completeSale(identity: Identity, number: string): Promise<PosSale> {
  return request<PosSale>(`/api/v1/pos/sales/${encodeURIComponent(number)}/complete`, identity, {
    method: "POST",
  });
}

/**
 * The sale's receipt.
 *
 * The contract wraps it (`{receipt: {...}}`); every caller wants the inside, so it is
 * unwrapped here, once.
 */
export async function saleReceipt(identity: Identity, number: string): Promise<Receipt> {
  const body = await request<components["schemas"]["PosReceiptOut"]>(
    `/api/v1/pos/sales/${encodeURIComponent(number)}/receipt`,
    identity,
  );
  return body.receipt;
}

/** Void an abandoned basket, or refund a completed sale — either way, with a reason. */
export function voidSale(identity: Identity, number: string, reason: string): Promise<PosSale> {
  return request<PosSale>(`/api/v1/pos/sales/${encodeURIComponent(number)}/void`, identity, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** One note in or out of the drawer, with the reason it moved. */
export interface NewDrawerMovement {
  terminal: string;
  movementType: MovementType;
  amount: string;
  reason: string;
  on?: string;
}

export function recordDrawerMovement(
  identity: Identity,
  movement: NewDrawerMovement,
): Promise<DrawerMovement> {
  return request<DrawerMovement>("/api/v1/pos/drawer-movements", identity, {
    method: "POST",
    body: JSON.stringify({
      terminal: movement.terminal,
      movement_type: movement.movementType,
      amount: movement.amount,
      reason: movement.reason,
      on: movement.on,
    }),
  });
}

/** Open a shift: the terminal and the float its drawer starts with. */
export interface NewShift {
  terminal: string;
  openingFloat?: string;
  on?: string;
}

export function openShift(identity: Identity, shift: NewShift): Promise<PosShift> {
  return request<PosShift>("/api/v1/pos/shifts", identity, {
    method: "POST",
    body: JSON.stringify({
      terminal: shift.terminal,
      opening_float: shift.openingFloat,
      on: shift.on,
    }),
  });
}

/**
 * The shift a terminal is trading in.
 *
 * A till with no open shift is a refusal like any other rather than an empty answer, so
 * this rejects — the page renders the message and offers to open one.
 */
export function currentShift(identity: Identity, terminal: string): Promise<PosShift> {
  return request<PosShift>(
    `/api/v1/pos/shifts/current?terminal=${encodeURIComponent(terminal)}`,
    identity,
  );
}

/** Close a shift on a count, with the reason a variance needs. */
export interface ShiftClose {
  countedCash: string;
  reason?: string;
}

export function closeShift(
  identity: Identity,
  shiftId: string,
  close: ShiftClose,
): Promise<PosShift> {
  return request<PosShift>(
    `/api/v1/pos/shifts/${encodeURIComponent(shiftId)}/close`,
    identity,
    {
      method: "POST",
      body: JSON.stringify({ counted_cash: close.countedCash, reason: close.reason }),
    },
  );
}

/** One shift's Z-report: what the drawer did while it was open. */
export async function shiftReport(identity: Identity, shiftId: string): Promise<ZReport> {
  const body = await request<components["schemas"]["PosReportOut"]>(
    `/api/v1/pos/z-reports/shift/${encodeURIComponent(shiftId)}`,
    identity,
  );
  return body.report;
}

/** One day's Z-report, company-wide. */
export async function dayReport(identity: Identity, on: string): Promise<ZReport> {
  const body = await request<components["schemas"]["PosReportOut"]>(
    `/api/v1/pos/z-reports/day?on=${encodeURIComponent(on)}`,
    identity,
  );
  return body.report;
}

/**
 * Whether this company's tills must trade inside an open shift.
 *
 * `null` withdraws the statement, which is a third answer rather than a default.
 */
export function setCashDrawerPolicy(identity: Identity, required: boolean | null): Promise<Company> {
  return request<Company>("/api/v1/pos/cash-drawer-policy", identity, {
    method: "POST",
    body: JSON.stringify({ required }),
  });
}

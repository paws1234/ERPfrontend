/**
 * T-6.PORTAL.01 — what a supplier's own page is built from.
 *
 * The portal's payload is the supplier's documents and nothing else: the backend decides
 * which ones (an account is one supplier) and this repository only presents them. Three
 * things here are logic rather than markup, and they are stated once so the page and the
 * tests read them the same way:
 *
 * * **The payload is read, never assumed.** `documents` arrives as an open object, so every
 *   list and every field is read defensively: something that is not a document is *not a
 *   document* rather than a row of blanks, and an amount that is not an amount reads as "not
 *   an amount" (the rule `lib/pos` keeps for money, reused rather than re-derived).
 * * **A field has three states** — withheld (the key is absent), unset (present but null) and
 *   a value — the same three `lib/pipeline` states every screen in this repository prints
 *   differently.
 * * **A response is refused before it is sent.** A line with no price, and a submission with
 *   no lines, are the two mistakes a supplier makes; both are refused here with the line
 *   named, so the backend never has to answer "which line did you mean?".
 */

import { amount, type Money } from "./pos.ts";
// Stated with its extension for the same reason as `./pos.ts`: a test loads this module
// through node's own loader, not only through the bundler.
import { request, type Identity } from "./api.ts";
import type { components } from "./contract";
import type { FieldState } from "./pipeline";

export type PortalDocuments = components["schemas"]["PortalDocumentsOut"]["documents"];
export type PortalResponse = components["schemas"]["PortalResponseIn"];

/** The kinds of document a supplier's page shows. */
export type DocumentKind = "RFQ" | "Order" | "Invoice";

export interface PortalRfqLine {
  lineNo: number;
  description: string;
  quantity: Money | null;
  uom: string;
}

export interface PortalRfq {
  number: string;
  issuedOn: FieldState<string>;
  responseDeadline: FieldState<string>;
  answered: boolean;
  answeredOn: FieldState<string>;
  lines: PortalRfqLine[];
}

export interface PortalOrder {
  number: string;
  status: FieldState<string>;
  requiredDate: FieldState<string>;
  total: Money | null;
  currency: FieldState<string>;
  acknowledged: boolean;
  lines: number;
}

export interface PortalInvoice {
  number: string;
  status: FieldState<string>;
  invoiceDate: FieldState<string>;
  dueDate: FieldState<string>;
  total: Money | null;
}

export interface PortalView {
  supplier: { code: string; name: FieldState<string> } | null;
  subject: FieldState<string>;
  rfqs: PortalRfq[];
  orders: PortalOrder[];
  invoices: PortalInvoice[];
  summary: { rfqs: number; orders: number; invoices: number; awaitingAnswer: number };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A field's three states, stated the way `lib/pipeline` states them. */
function state(value: unknown): FieldState<string> {
  if (value === undefined) {
    return { kind: "withheld" };
  }
  if (value === null) {
    return { kind: "unset" };
  }
  return { kind: "value", value: String(value) };
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function quantity(value: unknown): Money | null {
  return amount(value);
}

function lines(value: unknown): PortalRfqLine[] {
  return list(value).map((line) => ({
    lineNo: typeof line.line_no === "number" ? line.line_no : 0,
    description: String(line.description ?? `line ${String(line.line_no ?? "?")}`),
    quantity: quantity(line.quantity),
    uom: String(line.uom ?? ""),
  }));
}

/** Read the portal payload as the page shows it, or `null` when it is not one. */
export function readPortal(value: unknown): PortalView | null {
  if (!isObject(value)) {
    return null;
  }
  const supplier = isObject(value.supplier) ? value.supplier : null;
  const rfqs = list(value.rfqs).map((rfq) => ({
    number: String(rfq.number ?? ""),
    issuedOn: state(rfq.issued_on),
    responseDeadline: state(rfq.response_deadline),
    answered: rfq.answered === true,
    answeredOn: state(rfq.answered_on),
    lines: lines(rfq.lines),
  }));
  const orders = list(value.orders).map((order) => ({
    number: String(order.number ?? ""),
    status: state(order.status),
    requiredDate: state(order.required_date),
    total: quantity(order.total),
    currency: state(order.currency),
    acknowledged: order.status === "acknowledged",
    lines: list(order.lines).length,
  }));
  const invoices = list(value.invoices).map((invoice) => ({
    number: String(invoice.number ?? ""),
    status: state(invoice.status),
    invoiceDate: state(invoice.invoice_date),
    dueDate: state(invoice.due_date),
    total: quantity(invoice.gross_amount),
  }));
  if (rfqs.length === 0 && orders.length === 0 && invoices.length === 0 && supplier === null) {
    return null;
  }
  return {
    supplier:
      supplier === null
        ? null
        : { code: String(supplier.code ?? ""), name: state(supplier.name) },
    subject: state(value.subject),
    rfqs,
    orders,
    invoices,
    summary: {
      rfqs: rfqs.length,
      orders: orders.length,
      invoices: invoices.length,
      awaitingAnswer: rfqs.filter((rfq) => !rfq.answered).length,
    },
  };
}

/**
 * One price for one RFQ line, as the form states them.
 *
 * A price that cannot be read, and a line the form left empty, are both refusals with the
 * line named — never a zero: quoting nothing is not quoting free.
 */
export function responseLines(
  rfq: PortalRfq,
  prices: Record<string, string>,
): { lines: { line_no: number; unit_price: string }[] } | { refused: string } {
  const stated: { line_no: number; unit_price: string }[] = [];
  for (const line of rfq.lines) {
    const raw = (prices[String(line.lineNo)] ?? "").trim();
    if (raw === "") {
      return { refused: `line ${line.lineNo} has no price; a quote states one for every line` };
    }
    const read = amount(raw);
    if (read === null || read.units < 0n) {
      return { refused: `line ${line.lineNo} quotes ${raw}, which is not a price` };
    }
    stated.push({ line_no: line.lineNo, unit_price: read.text });
  }
  if (stated.length === 0) {
    return { refused: "this RFQ has no lines to quote" };
  }
  return { lines: stated };
}

/** A field a form left blank, as the contract's own reading of it: absent, not empty. */
export function stated(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

/** The supplier's own documents, read through the generated client. */
export async function readPortalDocuments(identity: Identity): Promise<PortalDocuments> {
  const answer = await request<components["schemas"]["PortalDocumentsOut"]>(
    "/api/v1/portal/documents",
    identity,
  );
  return answer.documents;
}

/** Answer one RFQ. The response is the matrix's own record, one per supplier. */
export async function syncPortalResponse(
  identity: Identity,
  number: string,
  response: PortalResponse,
): Promise<components["schemas"]["PortalWriteOut"]> {
  return request<components["schemas"]["PortalWriteOut"]>(
    `/api/v1/portal/rfqs/${encodeURIComponent(number)}/responses`,
    identity,
    { method: "POST", body: JSON.stringify(response) },
  );
}

/** Take one purchase order on. */
export function acknowledgeOrder(
  identity: Identity,
  number: string,
): Promise<components["schemas"]["PortalWriteOut"]> {
  return request<components["schemas"]["PortalWriteOut"]>(
    `/api/v1/portal/orders/${encodeURIComponent(number)}/acknowledge`,
    identity,
    { method: "POST" },
  );
}

/** Submit an invoice — recorded as a draft, for the buyer to post and match. */
export function submitInvoice(
  identity: Identity,
  invoice: components["schemas"]["PortalInvoiceIn"],
): Promise<components["schemas"]["PortalWriteOut"]> {
  return request<components["schemas"]["PortalWriteOut"]>("/api/v1/portal/invoices", identity, {
    method: "POST",
    body: JSON.stringify(invoice),
  });
}

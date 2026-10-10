"use server";

/**
 * The till's writes: the sale, its lines, its tenders, its end, and the drawer.
 *
 * Server actions, for the reason the board's are: the browser never holds the identity
 * the backend needs and never calls the API itself — `instanceIdentity()` reads the
 * container's own environment here, on the server, exactly as the reads do.
 *
 * Every action answers with one sentence rather than throwing: a 401, a 403 and a
 * domain refusal all arrive as the same three types `lib/api` defines, and a refusal
 * **keeps the till exactly as it was** (`denied`), so a rejected tender does not take
 * the basket off the screen. What a step that worked answers with is the sale *after*
 * it, which is the only way the till can know what its next step is working on — the
 * contract has no `GET` for an open sale.
 *
 * The writes that move the drawer or the shift re-validate `/pos`, because the shift and
 * its expected cash are rendered from the API on the server and completing a sale moves
 * them.
 */

import { revalidatePath } from "next/cache";

import { ApiFailure, NotPermitted, Unauthenticated, instanceIdentity } from "@/lib/api";
import {
  closeShift,
  completeSale,
  syncQueuedSales,
  isMovementType,
  isTenderType,
  openSale,
  openShift,
  recordDrawerMovement,
  saleReceipt,
  scanItem,
  setCashDrawerPolicy,
  takeTender,
  voidSale,
  type PosSale,
  type Receipt,
} from "@/lib/pos";

import { syncBody, type QueuedSale } from "@/lib/offline";

import type { SaidState } from "./ui";

export interface TillState extends SaidState {
  /** The sale as it now stands; absent only before the first one is opened. */
  sale?: PosSale;
  /** The receipt, when the step that ran was the one that read it. */
  receipt?: Receipt;
}

/** The one sentence a refused action shows. Nothing here swallows a refusal. */
function describe(error: unknown): string {
  if (error instanceof Unauthenticated) {
    return "Sign in required.";
  }
  if (error instanceof NotPermitted || error instanceof ApiFailure) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** A trimmed form field. A blank one is the empty string, never `undefined`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A form field, or `undefined` when it was left blank — "absent", not "empty". */
function stated(form: FormData, name: string): string | undefined {
  const value = field(form, name);
  return value === "" ? undefined : value;
}

/** A step the till refused: the sentence, and the basket exactly as it was. */
function denied(previous: TillState | null, message: string): TillState {
  return { ok: false, message, sale: previous?.sale, receipt: previous?.receipt };
}

/**
 * A step that worked: the sale it produced, and the receipt when the step read one.
 *
 * A receipt is deliberately dropped by every other step — once the sale has moved, the
 * slip read a moment ago is a statement about a basket that no longer exists.
 */
function stepped(
  previous: TillState | null,
  message: string,
  step: { sale?: PosSale; receipt?: Receipt } = {},
): TillState {
  return { ok: true, message, sale: step.sale ?? previous?.sale, receipt: step.receipt };
}

/** Open a basket. Until it is completed, nothing has moved: no stock, no posting. */
export async function newSale(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  try {
    const sale = await openSale(instanceIdentity(), {
      number: field(form, "number"),
      terminal: field(form, "terminal"),
      locationCode: field(form, "location_code"),
      customerCode: stated(form, "customer_code"),
      currency: stated(form, "currency"),
      soldOn: stated(form, "sold_on"),
    });
    return stepped(previous, `Sale ${sale.number} is ${sale.status} on ${sale.terminal}.`, {
      sale,
    });
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/** One code onto the basket, priced from the shelf price the till states. */
export async function scanSale(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  try {
    const barcode = field(form, "barcode");
    const sale = await scanItem(instanceIdentity(), field(form, "number"), {
      barcode,
      basePrice: field(form, "base_price"),
      quantity: stated(form, "quantity"),
      uom: stated(form, "uom"),
      campaign: stated(form, "campaign"),
    });
    return stepped(
      previous,
      `${barcode} is on sale ${sale.number}: ${sale.lines.length} line${sale.lines.length === 1 ? "" : "s"}, total ${sale.total}.`,
      { sale },
    );
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/** One payment onto the basket. */
export async function tenderSale(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  const tenderType = field(form, "tender_type");
  if (!isTenderType(tenderType)) {
    return denied(previous, `'${tenderType}' is not a tender this till takes.`);
  }
  try {
    const sale = await takeTender(instanceIdentity(), field(form, "number"), {
      tenderType,
      amount: field(form, "amount"),
      reference: stated(form, "reference"),
    });
    return stepped(
      previous,
      `${tenderType} on sale ${sale.number}: ${sale.tendered} taken, ${sale.total} due.`,
      { sale },
    );
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/** Complete the sale — the step that issues stock and posts it. */
export async function finishSale(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  try {
    const sale = await completeSale(instanceIdentity(), field(form, "number"));
    revalidatePath("/pos");
    return stepped(previous, `Sale ${sale.number} is ${sale.status}.`, { sale });
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/** Void the basket, or refund a completed sale — either way the reason is the record. */
export async function cancelSale(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  try {
    const sale = await voidSale(instanceIdentity(), field(form, "number"), field(form, "reason"));
    revalidatePath("/pos");
    return stepped(previous, `Sale ${sale.number} is ${sale.status}.`, { sale });
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/**
 * Read the receipt.
 *
 * A read, but it belongs with the writes: the sale is only ever in this component's
 * state, so the number it is read for comes from the form the till rendered.
 */
export async function printReceipt(
  previous: TillState | null,
  form: FormData,
): Promise<TillState> {
  try {
    const receipt = await saleReceipt(instanceIdentity(), field(form, "number"));
    return stepped(previous, "The receipt, as the API states it.", { receipt });
  } catch (error) {
    return denied(previous, describe(error));
  }
}

/** Open the shift a terminal trades in. */
export async function openTill(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  try {
    const shift = await openShift(instanceIdentity(), {
      terminal: field(form, "terminal"),
      openingFloat: stated(form, "opening_float"),
      on: stated(form, "on"),
    });
    revalidatePath("/pos");
    return { ok: true, message: `Shift ${shift.id} is ${shift.status} on ${shift.terminal}.` };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Close the shift on a count. A variance is the backend's to state, not this file's. */
export async function closeTill(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  try {
    const shift = await closeShift(instanceIdentity(), field(form, "shift_id"), {
      countedCash: field(form, "counted_cash"),
      reason: stated(form, "reason"),
    });
    revalidatePath("/pos");
    return {
      ok: true,
      message:
        shift.variance === null
          ? `Shift ${shift.id} is ${shift.status}.`
          : `Shift ${shift.id} is ${shift.status}; variance ${shift.variance}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Cash in or out of the drawer outside a sale, with its reason. */
export async function moveDrawer(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  const movementType = field(form, "movement_type");
  if (!isMovementType(movementType)) {
    return { ok: false, message: `'${movementType}' is not a drawer movement this till records.` };
  }
  try {
    const movement = await recordDrawerMovement(instanceIdentity(), {
      terminal: field(form, "terminal"),
      movementType,
      amount: field(form, "amount"),
      reason: field(form, "reason"),
      on: stated(form, "on"),
    });
    revalidatePath("/pos");
    return {
      ok: true,
      message: `${movement.amount} ${movement.movement_type} on ${movement.terminal} for '${movement.reason}'.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/**
 * State, change or withdraw whether tills need an open shift.
 *
 * Three answers, not two: a blank choice withdraws the statement rather than asserting
 * either one, which is why the body sends `null` and not `false`.
 */
export async function statePolicy(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  const choice = field(form, "required");
  if (choice !== "" && choice !== "yes" && choice !== "no") {
    return { ok: false, message: `'${choice}' is not an answer about the cash drawer.` };
  }
  try {
    const company = await setCashDrawerPolicy(
      instanceIdentity(),
      choice === "" ? null : choice === "yes",
    );
    revalidatePath("/pos");
    return {
      ok: true,
      message:
        company.cash_drawer_required === null || company.cash_drawer_required === undefined
          ? `${company.code} states no cash-drawer policy.`
          : `${company.code}: tills ${company.cash_drawer_required ? "must" : "need not"} trade inside an open shift.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** What a replay answered: the sentence, and the report the terminal applies to its queue. */
export interface QueueState extends SaidState {
  /** The run's report as the API stated it, for the queue in the terminal to be read off. */
  report?: unknown;
}

/**
 * Replay the terminal's offline queue (T-6.OFFLINE.01).
 *
 * The queue is the browser's — it holds what the till sold while the network was away —
 * so it arrives as a form field and is sent as the request body. The batch carries the
 * terminal's own idempotency key, so a replay that is itself retried answers with the
 * first report instead of selling the queue twice; a report that came back is applied to
 * the queue by the panel, which drops what was accepted and keeps what was refused.
 */
export async function replayQueue(
  _previous: QueueState | null,
  form: FormData,
): Promise<QueueState> {
  const queued = field(form, "queue");
  let sales: QueuedSale[];
  try {
    sales = queued === "" ? [] : (JSON.parse(queued) as QueuedSale[]);
  } catch {
    return { ok: false, message: "The queue this terminal sent is not readable." };
  }
  if (sales.length === 0) {
    return { ok: false, message: "This terminal has nothing queued." };
  }
  const terminal = field(form, "terminal");
  const locationCode = field(form, "location_code");
  try {
    const answer = await syncQueuedSales(
      instanceIdentity(),
      syncBody(terminal, locationCode, field(form, "oversell_allowed") === "true", sales),
      // The terminal names the batch by the sale it starts with, so a resend of the same
      // queue is the same batch — and the numbers inside it are checked as well.
      `${terminal}-${sales[0]?.number ?? "queue"}`,
    );
    const report = answer.report as { accepted?: number; duplicates?: number; rejected?: number };
    return {
      ok: true,
      message:
        `${terminal}: ${report.accepted ?? 0} accepted, ${report.duplicates ?? 0} already` +
        ` stored, ${report.rejected ?? 0} refused.`,
      report: answer.report,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

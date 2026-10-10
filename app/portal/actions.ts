"use server";

/**
 * The portal's three writes: answer an RFQ, take an order on, submit an invoice.
 *
 * Server actions, for the reason every other write in this repository is one: the browser
 * never holds the identity the backend needs, so `instanceIdentity()` reads it here, on the
 * server. Each answers with one sentence rather than throwing — a 401, a 403 and a domain
 * refusal all arrive as the same three types `lib/api` defines, and a refusal leaves the page
 * as it was, so a rejected quote does not take the supplier's documents off the screen.
 *
 * What each action sends is built by `lib/portal`, which refuses an unreadable price before
 * anything crosses the network: the backend is never asked which line was meant.
 */

import { revalidatePath } from "next/cache";

import { ApiFailure, NotPermitted, Unauthenticated, instanceIdentity } from "@/lib/api";
import {
  acknowledgeOrder,
  responseLines,
  submitInvoice,
  syncPortalResponse,
  type PortalRfq,
} from "@/lib/portal";

import type { SaidState } from "../pos/ui";

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

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Answer one RFQ: one price per line, or a refusal naming the line. */
export async function answerRfq(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  const number = field(form, "number");
  let rfq: PortalRfq;
  try {
    rfq = JSON.parse(field(form, "rfq")) as PortalRfq;
  } catch {
    return { ok: false, message: `The lines of RFQ ${number} could not be read.` };
  }
  const prices: Record<string, string> = {};
  for (const line of rfq.lines) {
    prices[String(line.lineNo)] = field(form, `price_${line.lineNo}`);
  }
  const quoted = responseLines(rfq, prices);
  if ("refused" in quoted) {
    return { ok: false, message: quoted.refused };
  }
  try {
    const answer = await syncPortalResponse(instanceIdentity(), number, {
      received_on: field(form, "received_on"),
      lines: quoted.lines,
      currency: field(form, "currency") || undefined,
      lead_time_days: field(form, "lead_time_days")
        ? Number(field(form, "lead_time_days"))
        : undefined,
      note: field(form, "note") || undefined,
    });
    revalidatePath("/portal");
    return {
      ok: true,
      message: `RFQ ${number} answered with ${quoted.lines.length} line(s)${
        answer.recorded.late === true ? " (late)" : ""
      }.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Take one order on. */
export async function takeOnOrder(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  const number = field(form, "number");
  try {
    const answer = await acknowledgeOrder(instanceIdentity(), number);
    revalidatePath("/portal");
    return {
      ok: true,
      message: `Order ${number} is ${String(answer.recorded.status ?? "acknowledged")}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Submit an invoice as a draft. */
export async function submitOurInvoice(
  _previous: SaidState | null,
  form: FormData,
): Promise<SaidState> {
  const number = field(form, "number");
  const quantity = field(form, "quantity") || "1";
  const price = field(form, "unit_price");
  if (price === "" || !/^\d+(\.\d+)?$/.test(price)) {
    return { ok: false, message: `'${price}' is not a unit price this invoice can state.` };
  }
  try {
    const answer = await submitInvoice(instanceIdentity(), {
      number,
      invoice_date: field(form, "invoice_date"),
      supplier_reference: field(form, "supplier_reference"),
      order_number: field(form, "order_number") || undefined,
      lines: [
        {
          line_no: 1,
          description: field(form, "description") || "goods supplied",
          quantity,
          unit_price: price,
        },
      ],
    });
    revalidatePath("/portal");
    return {
      ok: true,
      message: `Invoice ${number} submitted as ${String(answer.recorded.status ?? "draft")}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

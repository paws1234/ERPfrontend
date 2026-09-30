"use server";

/**
 * T-3.SALES.02 — the writes that make the board drivable.
 *
 * A read-only board is a picture; these four actions are how a person configures
 * nothing and moves, loses and converts a card. They are **server actions**, which is
 * the whole point: the browser never holds the identity the backend needs, never
 * fetches the API itself and never learns a token — `instanceIdentity()` reads the
 * container's own environment here, on the server, exactly as the read path does.
 *
 * Every action answers with one sentence rather than throwing: a 401, a 403 and a
 * domain refusal all arrive as the same three types `lib/api` defines, and the form
 * shows what the backend said. A refusal that reached the browser as a stack trace
 * would be a refusal nobody reads.
 *
 * `revalidatePath` is what makes the board catch up: the page is rendered per request,
 * so re-validating its path re-reads the API and the moved card is in its new column.
 */

import { revalidatePath } from "next/cache";

import {
  ApiFailure,
  NotPermitted,
  Unauthenticated,
  convertOpportunity,
  createOpportunity,
  instanceIdentity,
  loseOpportunity,
  moveOpportunity,
} from "@/lib/api";

/** What a form gets back: whether it worked, and the one sentence to show. */
export interface ActionState {
  ok: boolean;
  message: string;
}

/** The one sentence a failed action shows. Nothing here swallows a refusal. */
function describe(error: unknown): string {
  if (error instanceof Unauthenticated) {
    return "Sign in required.";
  }
  if (error instanceof NotPermitted) {
    return error.message;
  }
  if (error instanceof ApiFailure) {
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

export async function newDeal(
  _previous: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  try {
    const created = await createOpportunity(instanceIdentity(), {
      customerCode: field(form, "customer_code"),
      name: field(form, "name"),
      owner: field(form, "owner"),
      value: stated(form, "value"),
      expectedClose: stated(form, "expected_close"),
      // No stage sent when the select is left on its blank option: the backend opens
      // the card in the first column, which is the company's own definition of "new".
      stage: stated(form, "stage"),
    });
    revalidatePath("/pipeline");
    return {
      ok: true,
      message: `${created.card.name ?? "The deal"} is on the board in ${created.stage}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function moveDeal(
  _previous: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  try {
    const moved = await moveOpportunity(
      instanceIdentity(),
      field(form, "opportunity_id"),
      field(form, "to_stage"),
      stated(form, "reason"),
    );
    revalidatePath("/pipeline");
    return {
      ok: true,
      message: `Moved to ${moved.stage} by ${moved.move?.actor ?? "you"}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function loseDeal(
  _previous: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  try {
    const ended = await loseOpportunity(
      instanceIdentity(),
      field(form, "opportunity_id"),
      field(form, "reason"),
    );
    revalidatePath("/pipeline");
    return {
      ok: true,
      message: `Lost: ${ended.card.lost_reason ?? "recorded"}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function convertDeal(
  _previous: ActionState | null,
  form: FormData,
): Promise<ActionState> {
  try {
    const quotation = await convertOpportunity(
      instanceIdentity(),
      field(form, "opportunity_id"),
      field(form, "number"),
      stated(form, "issued_on"),
    );
    revalidatePath("/pipeline");
    return {
      ok: true,
      message: `Quotation ${quotation.number} raised for ${quotation.customer_code}.`,
    };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

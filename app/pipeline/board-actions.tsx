"use client";

/**
 * T-3.SALES.02 — the board's controls: a new deal, and per card a move, an ending and
 * a conversion.
 *
 * A client component because these are the only interactions on the board that need
 * one — everything a card *says* is rendered on the server from the API payload. The
 * forms post to the server actions in `./actions`, so the identity the backend needs
 * stays on the server and this file never speaks to the API itself.
 *
 * Two rules the controls keep, both of them the backend's rather than this file's:
 *
 * * **The loss column is not a move target.** Ending a deal is its own action, because
 *   it needs a reason; the move select offers `movableStages(board)` so it can never
 *   offer a move the domain would refuse.
 * * **A card with no readable id gets no controls.** `id` is a card field, so a role
 *   may withhold it; a board that offered "Move" for a card it cannot address would be
 *   offering a button that fails.
 */

import { useActionState, type CSSProperties } from "react";

import type { ActionState } from "./actions";
import { convertDeal, loseDeal, moveDeal, newDeal } from "./actions";

const INPUT: CSSProperties = {
  padding: "0.25rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  font: "inherit",
  minWidth: 0,
};

const BUTTON: CSSProperties = {
  padding: "0.25rem 0.6rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  background: "#16181d",
  color: "#f6f7f9",
  font: "inherit",
  cursor: "pointer",
};

/** What an action said, in the colour that matches how it went. */
function Said({ state }: { state: ActionState | null }) {
  if (!state) {
    return null;
  }
  return (
    <p style={{ color: state.ok ? "#1c6b3a" : "#8a1c1c", margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
      {state.message}
    </p>
  );
}

function StageOptions({ stages }: { stages: string[] }) {
  return (
    <>
      {stages.map((stage) => (
        <option key={stage} value={stage}>
          {stage}
        </option>
      ))}
    </>
  );
}

/** Put a deal on the board. The columns offered are the company's own. */
export function NewDealForm({ stages }: { stages: string[] }) {
  const [state, submit, pending] = useActionState(newDeal, null);
  return (
    <form action={submit} style={{ background: "#fff", border: "1px solid #e6e8eb", borderRadius: 6, padding: "0.75rem" }}>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>New deal</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input name="customer_code" placeholder="Customer code" required style={INPUT} />
        <input name="name" placeholder="Deal name" required style={INPUT} />
        <input name="owner" placeholder="Owner" required style={INPUT} />
        <input name="value" placeholder="Value, e.g. 120000.00" inputMode="decimal" style={INPUT} />
        <input name="expected_close" type="date" style={INPUT} />
        <select name="stage" defaultValue="" style={INPUT}>
          <option value="">first stage</option>
          <StageOptions stages={stages} />
        </select>
        <button type="submit" disabled={pending} style={BUTTON}>
          {pending ? "Adding…" : "Add deal"}
        </button>
      </div>
      <Said state={state} />
    </form>
  );
}

/** Move, end or convert one card. */
export function CardActions({
  cardId,
  stages,
  canConvert,
}: {
  cardId: string;
  stages: string[];
  /** True when the card stands in a column the company marked won. */
  canConvert: boolean;
}) {
  const [moveState, move] = useActionState(moveDeal, null);
  const [lossState, lose] = useActionState(loseDeal, null);
  const [quoteState, quote] = useActionState(convertDeal, null);

  return (
    <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.35rem" }}>
      <form action={move} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <input type="hidden" name="opportunity_id" value={cardId} />
        <select name="to_stage" required defaultValue="" style={INPUT}>
          <option value="" disabled>
            move to…
          </option>
          <StageOptions stages={stages} />
        </select>
        <button type="submit" style={BUTTON}>
          Move
        </button>
        <Said state={moveState} />
      </form>
      <form action={lose} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <input type="hidden" name="opportunity_id" value={cardId} />
        <input name="reason" placeholder="Why it ended" required style={INPUT} />
        <button type="submit" style={BUTTON}>
          Mark lost
        </button>
        <Said state={lossState} />
      </form>
      {canConvert ? (
        <form action={quote} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          <input type="hidden" name="opportunity_id" value={cardId} />
          <input name="number" placeholder="Quotation number" required style={INPUT} />
          <input name="issued_on" type="date" style={INPUT} />
          <button type="submit" style={BUTTON}>
            Convert to quotation
          </button>
          <Said state={quoteState} />
        </form>
      ) : null}
    </div>
  );
}

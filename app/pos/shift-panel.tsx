"use client";

/**
 * The drawer's panel: the shift a terminal is trading in, the movements in and out of
 * its drawer, what the company requires of it, and the shift's Z-report.
 *
 * A client component for the same reason the till is one: the shift and its expected
 * cash are rendered from the API **on the server** (`./page`), so every form here posts
 * to a server action and re-validates the page rather than holding the drawer's figures
 * in the browser.
 */

import { useActionState } from "react";

import {
  MOVEMENT_TYPES,
  amount,
  amountLabel,
  reportRows,
  type PosShift,
  type ZReport,
} from "@/lib/pos";

import { closeTill, moveDrawer, openTill, statePolicy } from "./actions";
import { AmountRows, BUTTON, INPUT, LABEL, Said } from "./ui";

/** One figure of the shift, printed exactly or said not to be an amount. */
function Figure({ label, text }: { label: string; text: string | null | undefined }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
      <span style={{ color: "#5b6470" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {amountLabel(amount(text ?? null))}
      </span>
    </div>
  );
}

export function ShiftPanel({
  terminal,
  shift,
  policy,
  report,
}: {
  terminal: string;
  /** The shift this terminal is trading in, as the API stated it. */
  shift: PosShift | null;
  /** The company's cash-drawer statement: `null` is "not stated", not "not required". */
  policy: boolean | null;
  /** The shift's Z-report, when the API answered for it. */
  report: ZReport | null;
}) {
  const [openState, openShiftForm, opening] = useActionState(openTill, null);
  const [closeState, closeShiftForm, closing] = useActionState(closeTill, null);
  const [movementState, movementForm, moving] = useActionState(moveDrawer, null);
  const [policyState, policyForm, stating] = useActionState(statePolicy, null);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e6e8eb",
        borderRadius: 6,
        padding: "0.75rem",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Drawer — {terminal}</h2>

      <p style={{ margin: "0.25rem 0", color: "#5b6470" }}>
        {shift
          ? `Shift ${shift.id} · ${shift.status} · opened ${shift.opened_on}`
          : "No shift is open on this terminal, as far as the API states."}
      </p>

      {shift ? (
        <div style={{ maxWidth: "22rem" }}>
          <Figure label="opening float" text={shift.opening_float} />
          <Figure label="expected" text={shift.expected} />
          <Figure label="counted" text={shift.counted} />
          <Figure label="variance" text={shift.variance} />
        </div>
      ) : null}
      {shift?.variance_reason ? (
        <p style={{ margin: "0.25rem 0", color: "#8a4f00" }}>
          Variance: {shift.variance_reason}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
        {shift ? (
          <form action={closeShiftForm} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            <input type="hidden" name="shift_id" value={shift.id} />
            <input
              name="counted_cash"
              placeholder="Counted cash, e.g. 312.40"
              inputMode="decimal"
              required
              style={INPUT}
            />
            <input name="reason" placeholder="Reason a variance needs" style={INPUT} />
            <button type="submit" disabled={closing} style={BUTTON}>
              {closing ? "Closing…" : "Close shift"}
            </button>
            <Said state={closeState} />
          </form>
        ) : (
          <form action={openShiftForm} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            <input type="hidden" name="terminal" value={terminal} />
            <input
              name="opening_float"
              placeholder="Opening float, e.g. 100.00"
              inputMode="decimal"
              style={INPUT}
            />
            <input name="on" type="date" style={INPUT} />
            <button type="submit" disabled={opening} style={BUTTON}>
              {opening ? "Opening…" : "Open shift"}
            </button>
            <Said state={openState} />
          </form>
        )}

        <form action={movementForm} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          <input type="hidden" name="terminal" value={terminal} />
          <label htmlFor={`movement-type-${terminal}`} style={LABEL}>
            Movement
          </label>
          <select
            id={`movement-type-${terminal}`}
            name="movement_type"
            defaultValue="paid_in"
            required
            style={INPUT}
          >
            {MOVEMENT_TYPES.map((movementType) => (
              <option key={movementType} value={movementType}>
                {movementType.replace("_", " ")}
              </option>
            ))}
          </select>
          <input
            name="amount"
            placeholder="Amount, e.g. 50.00"
            inputMode="decimal"
            required
            style={INPUT}
          />
          <input name="reason" placeholder="Why it moved" required style={INPUT} />
          <input name="on" type="date" style={INPUT} />
          <button type="submit" disabled={moving} style={BUTTON}>
            Record movement
          </button>
          <Said state={movementState} />
        </form>

        <form action={policyForm} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          <select
            name="required"
            defaultValue={policy === null ? "" : policy ? "yes" : "no"}
            style={INPUT}
          >
            <option value="">not stated</option>
            <option value="yes">tills must trade inside a shift</option>
            <option value="no">tills may trade without one</option>
          </select>
          <button type="submit" disabled={stating} style={BUTTON}>
            {stating ? "Stating…" : "State the policy"}
          </button>
          <Said state={policyState} />
        </form>
      </div>

      {report ? (
        <div style={{ marginTop: "0.75rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.25rem" }}>Shift Z-report</h3>
          <AmountRows rows={reportRows(report)} />
        </div>
      ) : null}
    </div>
  );
}

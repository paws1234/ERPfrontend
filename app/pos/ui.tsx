/**
 * The pieces every till control shares: the two styles, the one sentence a form shows,
 * and a receipt or a Z-report printed as the API stated it.
 *
 * There is no `"use client"` here on purpose — the page renders `AmountRows` on the
 * server and the till and the shift panel render it in the browser, and all three want
 * the same reader rather than three that can disagree about a figure.
 */

import type { CSSProperties } from "react";

import type { AmountRow } from "@/lib/pos";

/** The one sentence a control shows, and whether it went well. */
export interface SaidState {
  ok: boolean;
  message: string;
}

export const INPUT: CSSProperties = {
  padding: "0.25rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  font: "inherit",
  minWidth: 0,
};

export const BUTTON: CSSProperties = {
  padding: "0.25rem 0.6rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  background: "#16181d",
  color: "#f6f7f9",
  font: "inherit",
  cursor: "pointer",
};

/** What a form was told, in the colour that matches how it went. */
export function Said({ state }: { state: SaidState | null }) {
  if (state === null) {
    return null;
  }
  return (
    <p
      style={{
        color: state.ok ? "#1c6b3a" : "#8a1c1c",
        margin: "0.25rem 0 0",
        fontSize: "0.85rem",
      }}
    >
      {state.message}
    </p>
  );
}

/**
 * A receipt or a report as the API stated it: every amount exact, and a value that is
 * not an amount said to be one rather than printed as a zero nobody counted.
 */
export function AmountRows({ rows }: { rows: AmountRow[] }) {
  if (rows.length === 0) {
    return <p style={{ color: "#5b6470" }}>The API stated nothing here.</p>;
  }
  return (
    <dl style={{ margin: 0 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            borderTop: "1px solid #e6e8eb",
            padding: "0.15rem 0",
          }}
        >
          <dt style={{ color: "#5b6470" }}>{row.label}</dt>
          <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
            {row.kind === "amount" ? (
              row.value.text
            ) : row.kind === "text" ? (
              row.text
            ) : (
              <em style={{ color: "#5b6470" }}>nothing stated</em>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

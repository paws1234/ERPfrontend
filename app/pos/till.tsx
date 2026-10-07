"use client";

/**
 * The till itself: the basket, what it totals, what has been tendered, and the four
 * controls that move it on (scan, tender, complete, void) plus the receipt.
 *
 * A client component because the sale only ever exists in this component's state — the
 * contract states no `GET` for an open sale, so the sale a step returns is how the next
 * step knows what it is working on. The steps are the separate server actions in
 * `./actions`; this dispatches on the `op` each form carries so all of them share the
 * one basket instead of each holding a half of it.
 *
 * What the till *says* about the basket is `lib/pos`'s arithmetic, not this file's:
 * totals, change and the tenders are printed from the same reader the tests state, so
 * the screen and the sums cannot disagree.
 */

import { useActionState } from "react";

import {
  TENDER_TYPES,
  amount,
  amountLabel,
  changeDisplay,
  isOpen,
  receiptRows,
  saleTotals,
  summariseTenders,
  type Money,
  type PosLine,
  type PosSale,
  type Receipt,
} from "@/lib/pos";

import {
  cancelSale,
  finishSale,
  newSale,
  printReceipt,
  scanSale,
  tenderSale,
  type TillState,
} from "./actions";
import { AmountRows, BUTTON, INPUT, LABEL, Said } from "./ui";

/** The amount a money string reads as, at the platform's scale, or that it is not one. */
function figure(text: string): string {
  return amountLabel(amount(text));
}

/** One line of the basket. */
function Line({ line }: { line: PosLine }) {
  return (
    <tr style={{ borderTop: "1px solid #e6e8eb", verticalAlign: "top" }}>
      <td>{line.line_no}</td>
      <td>
        {line.description}
        {line.rule ? (
          <>
            <br />
            <span style={{ color: "#5b6470" }}>{line.rule}</span>
          </>
        ) : null}
      </td>
      <td style={{ textAlign: "right" }}>
        {line.quantity} {line.uom}
      </td>
      <td style={{ textAlign: "right" }}>{figure(line.unit_price)}</td>
      <td style={{ textAlign: "right" }}>
        {figure(line.tax)}
        {line.tax_rule ? <span style={{ color: "#5b6470" }}> {line.tax_rule}</span> : null}
      </td>
    </tr>
  );
}

/** One figure of the sale, printed exactly or said not to be an amount. */
function Figure({ label, money }: { label: string; money: Money | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
      <span style={{ color: "#5b6470" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{amountLabel(money)}</span>
    </div>
  );
}

/** The basket: its lines, what it totals, and what has been handed over. */
function Basket({ sale }: { sale: PosSale }) {
  const totals = saleTotals(sale);
  const tenders = summariseTenders(sale);

  return (
    <>
      <p style={{ margin: "0.25rem 0", color: "#5b6470" }}>
        Sale {sale.number} · {sale.status} · {sale.terminal} · {sale.sold_on} ·{" "}
        {sale.currency}
        {sale.shift ? ` · shift ${sale.shift}` : ""}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>#</th>
            <th style={{ textAlign: "left" }}>Item</th>
            <th style={{ textAlign: "right" }}>Quantity</th>
            <th style={{ textAlign: "right" }}>Unit price</th>
            <th style={{ textAlign: "right" }}>Tax</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <Line key={line.line_no} line={line} />
          ))}
        </tbody>
      </table>

      <div style={{ maxWidth: "22rem", marginTop: "0.5rem" }}>
        <Figure label="net" money={totals.net} />
        <Figure label="tax" money={totals.tax} />
        <Figure label="total" money={totals.total} />
        <Figure label="tendered" money={totals.tendered} />
        <Figure label="applied" money={tenders.applied} />
        <p style={{ margin: "0.25rem 0 0" }}>{changeDisplay(totals.change)}</p>
      </div>

      {tenders.byType.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
          {tenders.byType.map((line) => (
            <li key={line.tenderType} style={{ color: "#5b6470" }}>
              {line.tenderType}: {line.count} × · tendered {line.tendered.text} · applied{" "}
              {line.applied.text}
              {line.invalid > 0 ? ` · ${line.invalid} unreadable` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {tenders.invalid > 0 ? (
        <p style={{ color: "#8a1c1c", margin: "0.25rem 0 0" }}>
          {tenders.invalid} tender{tenders.invalid === 1 ? "" : "s"} state an amount this till
          cannot read, so the sale is counted as unpaid rather than as paid.
        </p>
      ) : (
        <p style={{ margin: "0.25rem 0 0", color: tenders.settled ? "#1c6b3a" : "#8a1c1c" }}>
          {tenders.settled
            ? "The tenders cover the total."
            : tenders.owed !== null
              ? `${tenders.owed.text} still owed.`
              : "The sale states no total the till can read."}
        </p>
      )}
    </>
  );
}

/** The steps that are separate server actions, chosen by the `op` the form carries. */
async function step(previous: TillState | null, form: FormData): Promise<TillState> {
  switch (String(form.get("op"))) {
    case "scan":
      return scanSale(previous, form);
    case "tender":
      return tenderSale(previous, form);
    case "complete":
      return finishSale(previous, form);
    case "void":
      return cancelSale(previous, form);
    case "receipt":
      return printReceipt(previous, form);
    default:
      return newSale(previous, form);
  }
}

/** What the forms over an open sale need, and what they post to. */
interface FormProps {
  submit: (payload: FormData) => void;
  pending: boolean;
  number: string;
}

function NewSaleForm({
  submit,
  pending,
  terminal,
  currency,
}: {
  submit: (payload: FormData) => void;
  pending: boolean;
  terminal: string;
  currency: string;
}) {
  return (
    <form action={submit}>
      <input type="hidden" name="op" value="new" />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input name="number" placeholder="Sale number" required style={INPUT} />
        <input
          name="terminal"
          placeholder="Terminal"
          defaultValue={terminal}
          required
          style={INPUT}
        />
        <input name="location_code" placeholder="Location code" required style={INPUT} />
        <input name="customer_code" placeholder="Customer code" style={INPUT} />
        <input
          name="currency"
          placeholder="Currency"
          defaultValue={currency}
          style={INPUT}
        />
        <input name="sold_on" type="date" style={INPUT} />
        <button type="submit" disabled={pending} style={BUTTON}>
          {pending ? "Opening…" : "Open sale"}
        </button>
      </div>
    </form>
  );
}

function ScanForm({ submit, pending, number }: FormProps) {
  return (
    <form action={submit} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <input type="hidden" name="op" value="scan" />
      <input type="hidden" name="number" value={number} />
      <input name="barcode" placeholder="Barcode" required style={INPUT} />
      <input
        name="base_price"
        placeholder="Shelf price, e.g. 12.50"
        inputMode="decimal"
        required
        style={INPUT}
      />
      <input name="quantity" placeholder="Qty" inputMode="decimal" style={INPUT} />
      <input name="uom" placeholder="UoM" style={INPUT} />
      <input name="campaign" placeholder="Campaign" style={INPUT} />
      <button type="submit" disabled={pending} style={BUTTON}>
        Scan
      </button>
    </form>
  );
}

function TenderForm({ submit, pending, number }: FormProps) {
  return (
    <form action={submit} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <input type="hidden" name="op" value="tender" />
      <input type="hidden" name="number" value={number} />
      <label htmlFor={`tender-type-${number}`} style={LABEL}>
        Tender type
      </label>
      <select
        id={`tender-type-${number}`}
        name="tender_type"
        defaultValue="cash"
        required
        style={INPUT}
      >
        {TENDER_TYPES.map((tenderType) => (
          <option key={tenderType} value={tenderType}>
            {tenderType}
          </option>
        ))}
      </select>
      <input
        name="amount"
        placeholder="Amount, e.g. 20.00"
        inputMode="decimal"
        required
        style={INPUT}
      />
      <input name="reference" placeholder="Reference" style={INPUT} />
      <button type="submit" disabled={pending} style={BUTTON}>
        Take tender
      </button>
    </form>
  );
}

export function Till({ terminal, currency }: { terminal: string; currency: string }) {
  const [state, submit, pending] = useActionState(step, null);
  const sale = state?.sale ?? null;
  const receipt: Receipt | null = state?.receipt ?? null;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e6e8eb",
        borderRadius: 6,
        padding: "0.75rem",
        marginTop: "1rem",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Till</h2>
      <Said state={state} />

      {sale === null ? (
        <NewSaleForm submit={submit} pending={pending} terminal={terminal} currency={currency} />
      ) : (
        <>
          <Basket sale={sale} />

          {isOpen(sale) ? (
            <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
              <ScanForm submit={submit} pending={pending} number={sale.number} />
              <TenderForm submit={submit} pending={pending} number={sale.number} />
              <form action={submit} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <input type="hidden" name="op" value="complete" />
                <input type="hidden" name="number" value={sale.number} />
                <button type="submit" disabled={pending} style={BUTTON}>
                  {pending ? "Working…" : "Complete — issue stock and post"}
                </button>
              </form>
            </div>
          ) : (
            <p style={{ color: "#5b6470", margin: "0.5rem 0" }}>
              The sale is {sale.status}: the till offers it no more scans or tenders. Only
              the backend states that for certain, so a step it refuses says so above.
            </p>
          )}

          {/* Offered whatever the status, like the receipt: on an open basket this
              abandons it, and on a completed sale it is the refund the backend's own
              state machine decides — taking it away the moment a sale completes would
              remove the only control that can give the customer their money back. */}
          <form
            action={submit}
            style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="op" value="void" />
            <input type="hidden" name="number" value={sale.number} />
            <label htmlFor={`void-reason-${sale.number}`} style={LABEL}>
              Why
            </label>
            <input
              id={`void-reason-${sale.number}`}
              name="reason"
              placeholder="Why it is voided or refunded"
              required
              style={INPUT}
            />
            <button type="submit" disabled={pending} style={BUTTON}>
              Void / refund
            </button>
          </form>

          {/* Always offered, whatever the status: reading a receipt is a read, and where the
              sale is in its life is the backend's to refuse rather than this file's guess. */}
          <form
            action={submit}
            style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="op" value="receipt" />
            <input type="hidden" name="number" value={sale.number} />
            <button type="submit" disabled={pending} style={BUTTON}>
              {pending ? "Working…" : "Receipt"}
            </button>
          </form>

          {receipt ? (
            <div style={{ marginTop: "0.75rem" }}>
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.25rem" }}>Receipt</h3>
              <AmountRows rows={receiptRows(receipt)} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

"use client";

/**
 * The portal's three forms, and the sentence each one answers with.
 *
 * A client component because a write's answer has to be put on the page after the fact: a
 * domain refusal, a missing capability and a success all arrive as one `SaidState` sentence
 * (the same reader the till shows), and a refusal leaves the documents exactly as they were.
 *
 * Each form states only what the backend cannot know: the prices this supplier quotes, and the
 * invoice it is submitting. Which supplier, which documents and whether the act is allowed are
 * the account's and the capability's — a form cannot offer either, and does not try.
 */

import { useActionState } from "react";

import type { PortalView } from "@/lib/portal";

import { answerRfq, submitOurInvoice, takeOnOrder } from "./actions";
import { BUTTON, INPUT, LABEL, Said, type SaidState } from "../pos/ui";

function AnswerForm({ number, lines }: { number: string; lines: PortalView["rfqs"][number]["lines"] }) {
  const [state, submit, pending] = useActionState<SaidState | null, FormData>(answerRfq, null);
  return (
    <form action={submit} style={{ marginTop: "0.5rem" }}>
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="rfq" value={JSON.stringify({ number, lines })} />
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        {lines.map((line) => (
          <span key={line.lineNo} style={{ display: "inline-flex", gap: "0.25rem" }}>
            <label htmlFor={`price_${number}_${line.lineNo}`} style={LABEL}>
              Line {line.lineNo}
            </label>
            <input
              id={`price_${number}_${line.lineNo}`}
              name={`price_${line.lineNo}`}
              placeholder="Unit price"
              inputMode="decimal"
              required
              style={INPUT}
            />
          </span>
        ))}
        <input name="received_on" type="date" required style={INPUT} />
        <input name="lead_time_days" placeholder="Lead time (days)" inputMode="numeric" style={INPUT} />
        <input name="currency" placeholder="Currency" style={INPUT} />
        <button type="submit" disabled={pending} style={BUTTON}>
          {pending ? "Sending…" : `Answer ${number}`}
        </button>
      </div>
      <Said state={state} />
    </form>
  );
}

function AcknowledgeForm({ number }: { number: string }) {
  const [state, submit, pending] = useActionState<SaidState | null, FormData>(takeOnOrder, null);
  return (
    <form action={submit} style={{ display: "inline-flex", gap: "0.35rem", marginLeft: "0.5rem" }}>
      <input type="hidden" name="number" value={number} />
      <button type="submit" disabled={pending} style={BUTTON}>
        {pending ? "Sending…" : `Take on ${number}`}
      </button>
      <Said state={state} />
    </form>
  );
}

function InvoiceForm({ orders }: { orders: string[] }) {
  const [state, submit, pending] = useActionState<SaidState | null, FormData>(
    submitOurInvoice,
    null,
  );
  return (
    <form action={submit} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <input name="number" placeholder="Invoice number" required style={INPUT} />
      <input name="invoice_date" type="date" required style={INPUT} />
      <input name="supplier_reference" placeholder="Your reference" required style={INPUT} />
      <input
        name="order_number"
        placeholder="Against order"
        list="portal-orders"
        style={INPUT}
      />
      <datalist id="portal-orders">
        {orders.map((number) => (
          <option key={number} value={number} />
        ))}
      </datalist>
      <input name="description" placeholder="What for" style={INPUT} />
      <input name="quantity" placeholder="Qty" inputMode="decimal" style={INPUT} />
      <input name="unit_price" placeholder="Unit price" inputMode="decimal" required style={INPUT} />
      <button type="submit" disabled={pending} style={BUTTON}>
        {pending ? "Sending…" : "Submit invoice"}
      </button>
      <Said state={state} />
    </form>
  );
}

export function PortalWrites({ view }: { view: PortalView }) {
  const open = view.rfqs.filter((rfq) => !rfq.answered);
  const waiting = view.orders.filter((order) => !order.acknowledged);
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
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>What this supplier may do</h2>

      {open.length === 0 ? (
        <p style={{ color: "#5b6470", margin: "0 0 0.5rem" }}>
          Nothing is waiting for an answer.
        </p>
      ) : (
        open.map((rfq) => <AnswerForm key={rfq.number} number={rfq.number} lines={rfq.lines} />)
      )}

      <p style={{ margin: "0.75rem 0 0.25rem" }}>
        {waiting.length === 0
          ? "Every order released to this supplier has been taken on."
          : "Take an order on:"}{" "}
        {waiting.map((order) => (
          <AcknowledgeForm key={order.number} number={order.number} />
        ))}
      </p>

      <div style={{ marginTop: "0.75rem" }}>
        <InvoiceForm orders={view.orders.map((order) => order.number)} />
        <p style={{ color: "#5b6470", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
          A submitted invoice is recorded as a draft for the buyer to post and match — it is
          never approved by submitting it.
        </p>
      </div>
    </div>
  );
}

/**
 * T-6.PORTAL.01 — the supplier's own door.
 *
 * Only a supplier's documents are here — the RFQs it was invited to, the orders released to
 * it and the invoices it submitted — because the backend decides that from the account the
 * request arrives under, and this screen presents what it was given. Nothing on this page
 * reaches the database: it is built from the published contract alone, like every other screen.
 *
 * Three things the page deliberately does **not** do:
 *
 * * it does not re-derive which documents are whose — a payload that is not a portal payload
 *   reads as "not one" (`lib/portal`) rather than as a page of blanks;
 * * it does not offer an action the backend would refuse — an answered RFQ, an acknowledged
 *   order and a submitted invoice are shown as such, and the forms for them are gone;
 * * it does not print the buyer's own view — what other suppliers quoted is not in the
 *   payload, and a page cannot show what it was not given.
 */

import { describeFailure, instanceIdentity } from "@/lib/api";
import { readPortal, readPortalDocuments, type PortalView } from "@/lib/portal";

import { PortalWrites } from "./writes";

// A supplier's documents are live data: rendered per request, never cached at build.
export const dynamic = "force-dynamic";

function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        border: "1px solid #d9a300",
        background: "#fff8e6",
        padding: "1rem",
        borderRadius: 6,
        marginBottom: "0.75rem",
      }}
    >
      <strong>{title}</strong>
      <p style={{ margin: "0.25rem 0 0" }}>{detail}</p>
    </div>
  );
}

export default async function PortalPage() {
  let view: PortalView | null = null;
  let failure: { title: string; detail: string } | null = null;
  try {
    view = readPortal(await readPortalDocuments(instanceIdentity()));
  } catch (error) {
    failure = describeFailure(error);
  }

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Supplier portal</h1>
      <p style={{ color: "#5b6470" }}>
        {view?.supplier
          ? `${view.supplier.code}${
              view.supplier.name.kind === "value" ? ` · ${view.supplier.name.value}` : ""
            }`
          : "No supplier is bound to this instance yet."}
        {view
          ? ` · ${view.summary.rfqs} RFQ(s), ${view.summary.orders} order(s), ${view.summary.invoices} invoice(s)`
          : ""}
      </p>

      {failure ? <Notice title={failure.title} detail={failure.detail} /> : null}
      {view === null && failure === null ? (
        <p style={{ color: "#5b6470" }}>
          This instance is not linked to a supplier: a portal account is a subject bound to one
          supplier, and nothing is shown without one.
        </p>
      ) : null}

      {view === null ? null : (
        <>
          <h2 style={{ fontSize: "1.1rem" }}>Requests for quotation</h2>
          {view.rfqs.length === 0 ? (
            <p style={{ color: "#5b6470" }}>Nothing has been asked of this supplier.</p>
          ) : null}
          {view.rfqs.map((rfq) => (
            <div
              key={rfq.number}
              style={{
                background: "#fff",
                border: "1px solid #e6e8eb",
                borderRadius: 6,
                padding: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <strong>{rfq.number}</strong>{" "}
              <span style={{ color: "#5b6470" }}>
                issued {rfq.issuedOn.kind === "value" ? rfq.issuedOn.value : "not shown"} · due{" "}
                {rfq.responseDeadline.kind === "value" ? rfq.responseDeadline.value : "not shown"}
                {rfq.answered ? ` · answered ${rfq.answeredOn.kind === "value" ? rfq.answeredOn.value : ""}` : ""}
              </span>
              <table style={{ borderCollapse: "collapse", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                <tbody>
                  {rfq.lines.map((line) => (
                    <tr key={line.lineNo}>
                      <td style={{ paddingRight: "0.75rem" }}>{line.lineNo}</td>
                      <td style={{ paddingRight: "0.75rem" }}>{line.description}</td>
                      <td style={{ paddingRight: "0.75rem", textAlign: "right" }}>
                        {line.quantity === null ? "not an amount" : line.quantity.text}
                      </td>
                      <td>{line.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <h2 style={{ fontSize: "1.1rem" }}>Purchase orders</h2>
          {view.orders.length === 0 ? (
            <p style={{ color: "#5b6470" }}>No order has been released to this supplier.</p>
          ) : null}
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {view.orders.map((order) => (
              <li key={order.number}>
                <strong>{order.number}</strong> ·{" "}
                {order.status.kind === "value" ? order.status.value : "not shown"}
                {order.acknowledged ? " (taken on)" : ""} · required{" "}
                {order.requiredDate.kind === "value" ? order.requiredDate.value : "not shown"} ·{" "}
                {order.total === null ? "not an amount" : `${order.total.text} ${order.currency.kind === "value" ? order.currency.value : ""}`}{" "}
                · {order.lines} line(s)
              </li>
            ))}
          </ul>

          <h2 style={{ fontSize: "1.1rem" }}>Invoices</h2>
          {view.invoices.length === 0 ? (
            <p style={{ color: "#5b6470" }}>Nothing has been submitted yet.</p>
          ) : null}
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {view.invoices.map((invoice) => (
              <li key={invoice.number}>
                <strong>{invoice.number}</strong> ·{" "}
                {invoice.status.kind === "value" ? invoice.status.value : "not shown"} ·{" "}
                {invoice.total === null ? "not an amount" : invoice.total.text} · due{" "}
                {invoice.dueDate.kind === "value" ? invoice.dueDate.value : "not shown"}
              </li>
            ))}
          </ul>

          <PortalWrites view={view} />
        </>
      )}
    </section>
  );
}

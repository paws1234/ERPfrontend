/**
 * T-2.PROC.04 — the comparative statement matrix.
 *
 * One RFQ, read through the generated client (nothing here reaches the database),
 * shown the way a buyer reads it: each requisition line across every supplier that
 * was asked, in one currency at one dated rate, with the basis printed above the
 * table rather than left to be inferred.
 *
 * Three states are deliberately distinct, because a comparison that merges them
 * misleads: **quoted** (a price), **no quote** (they answered and were silent about
 * this line), and **did not respond** (they never answered). A late answer is shown
 * as a price *with* the late mark — the decision to use it is the buyer's, not this
 * page's.
 */

import Link from "next/link";

import { instanceIdentity, readRfq, describeFailure } from "@/lib/api";
import {
  buildComparison,
  type Comparison,
  type ComparisonCell,
  type ComparisonRow,
} from "@/lib/comparison";

export const dynamic = "force-dynamic";

function Cell({
  cell,
  baseCurrency,
}: {
  cell: ComparisonCell;
  baseCurrency: string;
}) {
  if (cell.status === "did_not_respond") {
    return <em style={{ color: "#5b6470" }}>did not respond</em>;
  }
  if (cell.status === "no_quote") {
    return <em style={{ color: "#5b6470" }}>no quote for this line</em>;
  }
  return (
    <span>
      {cell.quotedUnitPrice} {cell.currency}
      {cell.currency === baseCurrency ? null : (
        <>
          <br />
          <span style={{ color: "#5b6470" }}>
            {cell.baseUnitPrice} {baseCurrency}
          </span>
        </>
      )}
      <br />
      <span style={{ color: "#5b6470" }}>
        {cell.taxInclusiveUnitPrice} {baseCurrency} incl.
      </span>
      <br />
      <span style={{ color: "#5b6470" }}>
        {cell.extended} {baseCurrency} extended
      </span>
      {cell.late ? (
        <>
          {" "}
          <strong style={{ color: "#8a4f00" }}>late</strong>
        </>
      ) : null}
    </span>
  );
}

function Row({
  row,
  suppliers,
  baseCurrency,
}: {
  row: ComparisonRow;
  suppliers: string[];
  baseCurrency: string;
}) {
  return (
    <tr style={{ borderTop: "1px solid #e6e8eb", verticalAlign: "top" }}>
      <td>
        {row.lineNo}. {row.description}
        <br />
        <span style={{ color: "#5b6470" }}>
          {row.quantity} {row.uom}
        </span>
      </td>
      {suppliers.map((supplier, index) => (
        <td key={supplier} style={{ textAlign: "right" }}>
          <Cell cell={row.cells[index]} baseCurrency={baseCurrency} />
        </td>
      ))}
    </tr>
  );
}

function Matrix({ comparison }: { comparison: Comparison }) {
  return (
    <>
      <p
        style={{
          background: "#eef4ff",
          border: "1px solid #c7d8f7",
          borderRadius: 6,
          padding: "0.6rem 0.9rem",
          color: "#22314a",
        }}
      >
        <strong>Basis:</strong> {comparison.label}
      </p>

      {comparison.nonResponders.length > 0 ? (
        <p style={{ color: "#5b6470" }}>
          No answer from {comparison.nonResponders.join(", ")}.
        </p>
      ) : null}
      {comparison.lateResponders.length > 0 ? (
        <p style={{ color: "#8a4f00" }}>
          Answered after the deadline: {comparison.lateResponders.join(", ")}.
        </p>
      ) : null}

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#fff",
        }}
      >
        <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>
          RFQ {comparison.rfq} against requisition {comparison.requisition}
        </caption>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Line</th>
            {comparison.suppliers.map((supplier) => (
              <th key={supplier} style={{ textAlign: "right" }}>
                {supplier}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <Row
              key={row.lineNo}
              row={row}
              suppliers={comparison.suppliers}
              baseCurrency={comparison.basis.base_currency}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

export default async function RfqComparisonPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  let comparison: Comparison | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    comparison = buildComparison(await readRfq(instanceIdentity(), number));
  } catch (error) {
    failure = describeFailure(error);
  }

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Comparative statement — {number}</h1>
      <p style={{ color: "#5b6470" }}>
        <Link href="/">Ledger</Link>
        {comparison ? (
          <>
            {" · "}
            <a href={`/rfqs/${encodeURIComponent(number)}/export`}>Export CSV</a>
          </>
        ) : null}
      </p>

      {failure ? (
        <div
          style={{
            border: "1px solid #d9a300",
            background: "#fff8e6",
            padding: "1rem",
            borderRadius: 6,
          }}
        >
          <strong>{failure.title}</strong>
          <p style={{ margin: "0.25rem 0 0" }}>{failure.detail}</p>
        </div>
      ) : null}

      {comparison ? <Matrix comparison={comparison} /> : null}
    </section>
  );
}

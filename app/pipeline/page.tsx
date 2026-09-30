/**
 * T-3.SALES.02 — the opportunity board.
 *
 * Rendered on the server from the API payload, like every other screen: this
 * process talks to the API and never to the database. The columns are whatever the
 * company configured — nothing about the stages is compiled in here — and a field
 * this instance's actor may not read is printed as *not shown* rather than as an
 * empty value, because the endpoint leaves it out of the payload entirely.
 */

import {
  describeFailure,
  readPipelineBoard,
  type Identity,
} from "@/lib/api";
import { boardSummary, cardName, orderedColumns, type PipelineBoard } from "@/lib/pipeline";

const IDENTITY: Identity = {
  companyId: process.env.COMPANY_ID ?? "00000000-0000-0000-0000-000000000000",
  actor: process.env.ACTOR ?? "shell",
};

// A board is live data: rendered per request, never cached at build.
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  let board: PipelineBoard | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    board = await readPipelineBoard(IDENTITY);
  } catch (error) {
    // 401 asks for a session, 403 explains itself, anything else says what it was.
    failure = describeFailure(error);
  }

  const summary = board ? boardSummary(board) : null;

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Opportunities</h1>
      <p style={{ color: "#5b6470" }}>
        {summary
          ? `${summary.cards} on the board · ${summary.open} open · ${summary.won} won · ${summary.lost} lost · visible value ${summary.total.toFixed(2)}`
          : "The pipeline board could not be read."}
      </p>
      {summary && summary.withheld > 0 ? (
        <p style={{ color: "#5b6470" }}>
          {summary.withheld} card{summary.withheld === 1 ? "" : "s"} carry a value your role
          may not read; the totals above exclude them rather than counting them as zero.
        </p>
      ) : null}

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

      {board ? (
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          {orderedColumns(board).map((column) => (
            <div
              key={column.stage.name}
              style={{
                flex: "1 1 12rem",
                background: "#f6f7f9",
                border: "1px solid #e6e8eb",
                borderRadius: 6,
                padding: "0.5rem",
              }}
            >
              <h2 style={{ fontSize: "1rem", margin: "0.25rem 0" }}>
                {column.stage.name}
                {column.stage.is_won ? " ✓" : ""}
                {column.stage.is_lost ? " ✕" : ""}
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {column.cards.map((card, index) => {
                  const valueShown =
                    "value" in card && card.value !== null && card.value !== undefined;
                  return (
                    <li
                      key={cardName(card) ?? `card-${index}`}
                      style={{
                        background: "#fff",
                        border: "1px solid #e6e8eb",
                        borderRadius: 4,
                        padding: "0.5rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <strong>{cardName(card) ?? "name not shown to you"}</strong>
                      {card.owner ? (
                        <div style={{ color: "#5b6470" }}>owner {card.owner}</div>
                      ) : null}
                      <div>{valueShown ? card.value : "value not shown to you"}</div>
                      {card.expected_close ? <div>{card.expected_close}</div> : null}
                      {card.lost_reason ? (
                        <div style={{ color: "#8a1c1c" }}>lost: {card.lost_reason}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * T-3.SALES.02 — the opportunity board.
 *
 * Rendered on the server from the API payload, like every other screen: this
 * process talks to the API and never to the database. The columns are whatever the
 * company configured — nothing about the stages is compiled in here — and a card
 * field is printed from the **same** state the summary counts (`lib/pipeline`), so
 * the two cannot disagree about whether a value was hidden, missing or unreadable.
 *
 * Identity comes from `instanceIdentity()`, the one place runtime identity is read.
 */

import { describeFailure, instanceIdentity, readPipelineBoard } from "@/lib/api";
import {
  boardSummary,
  moneyLabel,
  moneyState,
  movableStages,
  nameLabel,
  nameState,
  orderedColumns,
  type PipelineBoard,
} from "@/lib/pipeline";

import { CardActions, NewDealForm } from "./board-actions";

// A board is live data: rendered per request, never cached at build.
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  let board: PipelineBoard | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    board = await readPipelineBoard(instanceIdentity());
  } catch (error) {
    // 401 asks for a session, 403 explains itself, anything else says what it was.
    failure = describeFailure(error);
  }

  const summary = board ? boardSummary(board) : null;
  // The columns a card may be moved into — the loss column is not one of them, because
  // ending a deal is its own action and it requires a reason (see ./board-actions).
  const stages = board ? movableStages(board) : [];

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Opportunities</h1>
      <p style={{ color: "#5b6470" }}>
        {summary
          ? `${summary.cards} on the board · ${summary.open} open · ${summary.won} won · ${summary.lost} lost · visible value ${summary.total}`
          : "The pipeline board could not be read."}
      </p>
      {summary && summary.withheld > 0 ? (
        <p style={{ color: "#5b6470" }}>
          {summary.withheld} card{summary.withheld === 1 ? "" : "s"} carry a value your role
          may not read; the totals above exclude them rather than counting them as zero.
        </p>
      ) : null}
      {summary && (summary.unset > 0 || summary.invalid > 0) ? (
        <p style={{ color: "#5b6470" }}>
          {summary.unset + summary.invalid} card
          {summary.unset + summary.invalid === 1 ? "" : "s"} carry no readable amount
          ({summary.unset} with nothing recorded, {summary.invalid} that are not amounts);
          that is a fact about the data, not about your permissions.
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

      {board ? <NewDealForm stages={stages} /> : null}

      {board ? (
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "flex-start",
            flexWrap: "wrap",
            marginTop: "1rem",
          }}
        >
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
                  const name = nameState(card);
                  const money = moneyState(card);
                  return (
                    <li
                      key={name.kind === "value" ? name.value : `card-${index}`}
                      style={{
                        background: "#fff",
                        border: "1px solid #e6e8eb",
                        borderRadius: 4,
                        padding: "0.5rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <strong>{nameLabel(name)}</strong>
                      {card.owner ? (
                        <div style={{ color: "#5b6470" }}>owner {card.owner}</div>
                      ) : null}
                      <div>{moneyLabel(money)}</div>
                      {card.expected_close ? <div>{card.expected_close}</div> : null}
                      {card.lost_reason ? (
                        <div style={{ color: "#8a1c1c" }}>lost: {card.lost_reason}</div>
                      ) : null}
                      {typeof card.id === "string" ? (
                        <CardActions
                          cardId={card.id}
                          stages={stages}
                          canConvert={column.stage.is_won}
                        />
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

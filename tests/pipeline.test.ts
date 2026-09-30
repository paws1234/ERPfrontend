/**
 * T-3.SALES.02 — the board's two pieces of logic: column order and the meaning of a
 * missing value.
 *
 * The payloads below are exactly what the endpoint sends: a card whose `value` the
 * caller may not read simply has no `value` key (T-0.SEC.01's field permissions,
 * applied in the backend before the response leaves). The test's job is to prove
 * this repository does not quietly turn that into zero.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { boardSummary, cardValue, orderedColumns, type PipelineBoard } from "../lib/pipeline.ts";

const BOARD: PipelineBoard = [
  {
    stage: { name: "Won", position: 3, is_won: true, is_lost: false },
    cards: [{ name: "Warehouse fit-out", value: "120000.50", owner: "jo" }],
  },
  {
    stage: { name: "Lead", position: 0, is_won: false, is_lost: false },
    cards: [
      { name: "Visible deal", value: "1000.25", owner: "jo" },
      { name: "Hidden deal", owner: "maria" },
      // a genuine zero is a value, not a withheld one
      { name: "Zero deal", value: "0", owner: "jo" },
    ],
  },
  {
    stage: { name: "Lost", position: 4, is_won: false, is_lost: true },
    cards: [{ name: "Second deal", owner: "jo", lost_reason: "Budget withdrawn" }],
  },
];

test("columns come back in the configured order, whatever order they arrived in", () => {
  assert.deepEqual(
    orderedColumns(BOARD).map((column) => column.stage.name),
    ["Lead", "Won", "Lost"],
  );
});

test("a withheld value is null, and a real zero is zero", () => {
  const lead = orderedColumns(BOARD)[0];
  assert.equal(cardValue(lead.cards[0]), 1000.25);
  assert.equal(cardValue(lead.cards[1]), null, "an absent value must not read as zero");
  assert.equal(cardValue(lead.cards[2]), 0, "an explicit zero is a value");
  assert.equal(cardValue({ name: "Not a number", value: "n/a" }), null);
});

test("a withheld value is counted as withheld, never into the total", () => {
  const summary = boardSummary(BOARD);
  const lead = summary.stages[0];
  assert.equal(lead.cards, 3);
  assert.equal(lead.total, 1000.25, "the hidden card's value reached the total");
  assert.equal(lead.withheld, 1);
  assert.equal(summary.cards, 5);
  assert.equal(summary.total, 121000.75);
  assert.equal(summary.withheld, 2, "both hidden cards must be reported");
});

test("the summary separates open, won and lost cards by what the columns mean", () => {
  const summary = boardSummary(BOARD);
  assert.equal(summary.open, 3, "the three cards in the Lead column are the open ones");
  assert.equal(summary.won, 1);
  assert.equal(summary.lost, 1);
});

test("an empty board summarises to nothing rather than throwing", () => {
  const summary = boardSummary([]);
  assert.deepEqual(summary.stages, []);
  assert.equal(summary.cards, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.withheld, 0);
});

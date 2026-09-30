/**
 * T-3.SALES.02 — the board's logic: column order, what a card field says, and what a
 * total is.
 *
 * The payloads below are exactly what the endpoint sends: a card field the caller's
 * role may not read simply has **no key** (T-0.SEC.01's field permissions, applied in
 * the backend before the response leaves). The tests' job is to prove this repository
 * keeps four states apart — absent, null, malformed and a value — and never turns a
 * hidden or unreadable amount into zero.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boardSummary,
  moneyState,
  nameState,
  orderedColumns,
  type PipelineBoard,
  type PipelineCard,
} from "../lib/pipeline.ts";

/** The money text of a card that has one — narrows the state for the assertion. */
function amountText(card: PipelineCard): string {
  const state = moneyState(card);
  if (state.kind !== "value") {
    throw new Error(`expected a value, got ${state.kind}`);
  }
  return state.value.text;
}

const BOARD: PipelineBoard = [
  {
    stage: { name: "Won", position: 3, is_won: true, is_lost: false },
    cards: [
      { name: "Warehouse fit-out", value: "120000.50", owner: "jo" },
      // Past 2^53: through Number this total silently loses cents
      { name: "Big deal", value: "9007199254740993.000001", owner: "jo" },
    ],
  },
  {
    stage: { name: "Lead", position: 0, is_won: false, is_lost: false },
    cards: [
      { name: "Visible deal", value: "1000.25", owner: "jo" },
      { name: "Hidden deal", owner: "maria" },
      // a genuine zero is a value, not a withheld one
      { name: "Zero deal", value: "0", owner: "jo" },
      { name: "Unset deal", value: null, owner: "jo" },
      { name: "Odd deal", value: "n/a", owner: "jo" },
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

test("a field keeps absent, null, malformed and a value apart", () => {
  assert.deepEqual(moneyState({ name: "a" }), { kind: "withheld" }, "absent = hidden");
  assert.deepEqual(moneyState({ name: "b", value: null }), { kind: "unset" });
  assert.deepEqual(moneyState({ name: "c", value: "n/a" }), { kind: "invalid" });
  assert.deepEqual(moneyState({ name: "d", value: "" }), { kind: "invalid" }, "empty is not zero");
  assert.deepEqual(moneyState({ name: "e", value: "0" }), {
    kind: "value",
    value: { text: "0.000000", units: 0n },
  }, "an explicit zero is a value");
});

test("a money string is kept exact and padded to the platform scale", () => {
  assert.equal(amountText({ value: "1.005" }), "1.005000");
  assert.equal(amountText({ value: "1.005000" }), "1.005000");
  assert.equal(amountText({ value: "-2.5" }), "-2.500000");
  assert.equal(amountText({ value: "120000" }), "120000.000000");
  // seven decimals is contract drift, not a money value: refuse it rather than
  // silently dropping the seventh
  assert.deepEqual(moneyState({ value: "1.0000005" }), { kind: "invalid" });
});

test("a withheld name reads as withheld, never as an unnamed deal", () => {
  assert.deepEqual(nameState({ value: "1" }), { kind: "withheld" });
  assert.deepEqual(nameState({ name: null }), { kind: "unset" });
  assert.deepEqual(nameState({ name: "   " }), { kind: "unset" }, "a blank name names nothing");
  assert.deepEqual(nameState({ name: "  Trimmed  " }), { kind: "value", value: "Trimmed" });
});

test("only a hidden value counts as withheld, and totals are exact", () => {
  const summary = boardSummary(BOARD);
  const lead = summary.stages[0];
  assert.equal(lead.cards, 5);
  assert.equal(lead.total, "1000.250000", "the hidden, unset and odd cards reached the total");
  assert.equal(lead.withheld, 1, "only the absent field is a permission fact");
  assert.equal(lead.unset, 1, "an explicit null is not a permission fact");
  assert.equal(lead.invalid, 1, "an unreadable value is not a permission fact");
  assert.equal(summary.cards, 8);
  assert.equal(summary.withheld, 2);
  assert.equal(summary.unset, 1);
  assert.equal(summary.invalid, 1);
  // 1000.25 + 120000.50 + 9007199254740993.000001, exact — a sum binary floating
  // point cannot represent
  assert.equal(summary.total, "9007199254861993.750001");
});

test("a total does not drift the way binary floating point would", () => {
  const cents: PipelineBoard = [
    {
      stage: { name: "Only", position: 0, is_won: false, is_lost: false },
      cards: [{ name: "a", value: "0.1" }, { name: "b", value: "0.2" }],
    },
  ];
  // 0.1 + 0.2 in binary floating point is 0.30000000000000004
  assert.equal(boardSummary(cents).total, "0.300000");
});

test("the summary separates open, won and lost cards by what the columns mean", () => {
  const summary = boardSummary(BOARD);
  assert.equal(summary.open, 5, "the five cards in the Lead column are the open ones");
  assert.equal(summary.won, 2);
  assert.equal(summary.lost, 1);
});

test("an empty board summarises to nothing rather than throwing", () => {
  const summary = boardSummary([]);
  assert.deepEqual(summary.stages, []);
  assert.equal(summary.cards, 0);
  assert.equal(summary.total, "0.000000");
  assert.equal(summary.withheld, 0);
  assert.equal(summary.unset, 0);
  assert.equal(summary.invalid, 0);
});

/**
 * T-3.SALES.02 — the opportunity board, computed from the API payload.
 *
 * A Kanban board is mostly presentation, but three parts of it are logic worth
 * stating once and testing rather than repeating in a component: the **column order**
 * (the company configures it, so it arrives in the payload instead of being compiled
 * in here), **what a card field actually says**, and **what a total is**.
 *
 * **A card field has four states, not two.** The board endpoint omits a field the
 * caller's role may not read (T-0.SEC.01), so for each field the possibilities are:
 * *withheld* (absent — a restriction hid it), *unset* (present but `null` — nobody
 * entered anything), *invalid* (present but not a well-formed value) and a *value*.
 * Collapsing any two of them is how a screen ends up telling someone their role hid
 * something that was simply never filled in, so `moneyState`/`nameState` keep all
 * four and **every** reader — the card and the summary alike — goes through the same
 * one. Two readers disagreeing about the same field is the bug this shape prevents.
 *
 * **Money is exact.** Totals accumulate in scaled integers at the platform's
 * six-decimal scale, never through `Number` (`comparison.ts` states the same rule):
 * `Number("1.005000")` loses the tail, `Number("")` becomes `0`, and a total past
 * 2^53 loses cents. `""` and `"n/a"` are therefore *invalid*, not zero.
 */

import type { components } from "./contract";

export type PipelineBoard = components["schemas"]["PipelineColumnOut"][];
export type PipelineCard = components["schemas"]["PipelineCardOut"];

/** The platform's money scale: six decimal places (DOMAIN-MODELS.md §2). */
const SCALE = 6;

/**
 * What the platform means by a decimal string: an optional sign, digits, and an
 * optional fraction of at most the money scale.
 *
 * A longer fraction is refused rather than truncated. The API states money at this
 * scale, so seven decimal places is contract drift, and silently dropping the seventh
 * would be the same class of loss as reaching for `Number`.
 */
const DECIMAL = /^-?\d+(\.\d{1,6})?$/;

/** The four states a card field can be in. */
export type FieldState<T> =
  /** The field is absent from the payload: a field restriction hid it. */
  | { kind: "withheld" }
  /** The field is present and null: nothing has been set. */
  | { kind: "unset" }
  /** The field is present and is not a well-formed value. */
  | { kind: "invalid" }
  | { kind: "value"; value: T };

/** A decimal string with its exact integer of 10^-6 units. */
export interface Money {
  /** The amount at the platform's money scale, e.g. `120000.500000`. */
  text: string;
  /** The same amount in 10^-6 units — the only way a total is summed. */
  units: bigint;
}

export interface StageSummary {
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  /** How many cards stand in the column. */
  cards: number;
  /** The exact sum of the cards whose value this viewer may read, at the money scale. */
  total: string;
  /** Cards whose value a field restriction **hid** — never counted as zero. */
  withheld: number;
  /** Cards with no value recorded. Not a permission fact, so it is reported apart. */
  unset: number;
  /** Cards whose value is not an amount. */
  invalid: number;
}

export interface BoardSummary {
  stages: StageSummary[];
  cards: number;
  total: string;
  withheld: number;
  unset: number;
  invalid: number;
  /** Cards in columns the company has not marked won or lost. */
  open: number;
  won: number;
  lost: number;
}

/** The board in the order the company configured, not the order it arrived in. */
export function orderedColumns(board: PipelineBoard): PipelineBoard {
  return [...board].sort((left, right) => left.stage.position - right.stage.position);
}

/** 10^-6 units back to a decimal string at the money scale. */
function decimal(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}

/** A decimal string as 10^-6 units, or `null` when it is not one. */
function scaled(text: string): bigint | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const units = BigInt(`${whole === "" ? "0" : whole}${fraction.padEnd(SCALE, "0")}`);
  return negative ? -units : units;
}

/**
 * What a card's `value` says — keeping absent, null, invalid and numeric apart.
 *
 * `0` is a real answer and comes back as an amount; `""` and `"n/a"` do not, because
 * reading them as zero would understate a pipeline while looking authoritative.
 */
export function moneyState(card: PipelineCard): FieldState<Money> {
  if (!("value" in card) || card.value === undefined) {
    return { kind: "withheld" };
  }
  if (card.value === null) {
    return { kind: "unset" };
  }
  const units = scaled(card.value);
  return units === null
    ? { kind: "invalid" }
    : { kind: "value", value: { text: decimal(units), units } };
}

/**
 * What a card's `name` says, in the same four states.
 *
 * A blank name is `unset`, not `invalid`: it names nothing, and calling it malformed
 * would be a claim about the data rather than about its emptiness.
 */
export function nameState(card: PipelineCard): FieldState<string> {
  if (!("name" in card) || card.name === undefined) {
    return { kind: "withheld" };
  }
  if (card.name === null) {
    return { kind: "unset" };
  }
  const text = String(card.name).trim();
  return text === "" ? { kind: "unset" } : { kind: "value", value: text };
}

/** How a card's value is shown: never as an empty amount, never as zero by accident. */
export function moneyLabel(state: FieldState<Money>): string {
  switch (state.kind) {
    case "withheld":
      return "value not shown to you";
    case "unset":
      return "no value recorded";
    case "invalid":
      return "value is not an amount";
    default:
      return state.value.text;
  }
}

/** How a card's name is shown. */
export function nameLabel(state: FieldState<string>): string {
  switch (state.kind) {
    case "withheld":
      return "name not shown to you";
    case "unset":
      return "unnamed deal";
    case "invalid":
      return "name is not usable";
    default:
      return state.value;
  }
}

export function boardSummary(board: PipelineBoard): BoardSummary {
  const stages: StageSummary[] = orderedColumns(board).map((column) => {
    const states = column.cards.map(moneyState);
    const amounts = states.flatMap((state) =>
      state.kind === "value" ? [state.value.units] : [],
    );
    return {
      name: column.stage.name,
      position: column.stage.position,
      isWon: column.stage.is_won,
      isLost: column.stage.is_lost,
      cards: column.cards.length,
      total: decimal(amounts.reduce((sum, units) => sum + units, 0n)),
      withheld: states.filter((state) => state.kind === "withheld").length,
      unset: states.filter((state) => state.kind === "unset").length,
      invalid: states.filter((state) => state.kind === "invalid").length,
    };
  });

  const add = (pick: (stage: StageSummary) => number): number =>
    stages.reduce((running, stage) => running + pick(stage), 0);
  return {
    stages,
    cards: add((stage) => stage.cards),
    total: decimal(stages.reduce((sum, stage) => sum + (scaled(stage.total) ?? 0n), 0n)),
    withheld: add((stage) => stage.withheld),
    unset: add((stage) => stage.unset),
    invalid: add((stage) => stage.invalid),
    open: add((stage) => (stage.isWon || stage.isLost ? 0 : stage.cards)),
    won: add((stage) => (stage.isWon ? stage.cards : 0)),
    lost: add((stage) => (stage.isLost ? stage.cards : 0)),
  };
}

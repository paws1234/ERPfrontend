/**
 * T-3.SALES.02 — the opportunity board, computed from the API payload.
 *
 * A Kanban board is mostly presentation, but two parts of it are logic worth
 * stating once and testing rather than repeating in a component: the **column
 * order** (the company configures it, so it arrives in the payload instead of being
 * compiled in here) and **what a missing value means**.
 *
 * That second part is the point of this module. The board endpoint omits a field the
 * caller's role may not read (T-0.SEC.01), so a card's `value` is either a decimal
 * string or *absent* — and absent is not zero. A total that quietly counted a hidden
 * value as 0 would understate a pipeline while looking authoritative, so
 * `boardSummary` reports those cards separately, by stage, and never folds them into
 * the figure.
 */

import type { components } from "./contract";

export type PipelineBoard = components["schemas"]["PipelineColumnOut"][];
export type PipelineCard = components["schemas"]["PipelineCardOut"];

export interface StageSummary {
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  /** How many cards stand in the column. */
  cards: number;
  /** The sum of the cards whose value this caller may read. */
  total: number;
  /** Cards whose value was withheld from this caller — never counted as zero. */
  withheld: number;
}

export interface BoardSummary {
  stages: StageSummary[];
  cards: number;
  total: number;
  withheld: number;
  /** Cards in columns the company has not marked won or lost. */
  open: number;
  won: number;
  lost: number;
}

/** The board in the order the company configured, not the order it arrived in. */
export function orderedColumns(board: PipelineBoard): PipelineBoard {
  return [...board].sort((left, right) => left.stage.position - right.stage.position);
}

/**
 * A card's name, or `null` when this caller may not read it.
 *
 * `name` is optional in the contract for the same reason `value` is: the endpoint
 * omits **any** field a restriction hides, so a nameless card means "not shown to
 * you", never "a deal with no name". A blank name reads as withheld too — it names
 * nothing either way.
 */
export function cardName(card: PipelineCard): string | null {
  if (!("name" in card) || card.name === null || card.name === undefined) {
    return null;
  }
  const name = String(card.name).trim();
  return name === "" ? null : name;
}

/**
 * A card's value as a number, or `null` when it is **not shown** to this caller.
 *
 * `null` is returned both for an absent field and for a value that is not a decimal
 * string, so a caller cannot accidentally treat "withheld" as "zero" — `0` is a real
 * answer and comes back as `0`.
 */
export function cardValue(card: PipelineCard): number | null {
  if (!("value" in card) || card.value === null || card.value === undefined) {
    return null;
  }
  const parsed = Number(card.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boardSummary(board: PipelineBoard): BoardSummary {
  const stages: StageSummary[] = orderedColumns(board).map((column) => {
    const values = column.cards.map(cardValue);
    const shown = values.filter((value): value is number => value !== null);
    return {
      name: column.stage.name,
      position: column.stage.position,
      isWon: column.stage.is_won,
      isLost: column.stage.is_lost,
      cards: column.cards.length,
      // ponytail: a float sum, for the board's own header. Ceiling: a very large
      // pipeline could drift in the last cent. Upgrade path: sum the decimal
      // strings exactly (or ask the API for the total) — the per-document figures
      // that matter are already exact on the wire.
      total: shown.reduce((sum, value) => sum + value, 0),
      withheld: values.length - shown.length,
    };
  });
  const add = (pick: (stage: StageSummary) => number): number =>
    stages.reduce((running, stage) => running + pick(stage), 0);
  return {
    stages,
    cards: add((stage) => stage.cards),
    total: add((stage) => stage.total),
    withheld: add((stage) => stage.withheld),
    open: add((stage) => (stage.isWon || stage.isLost ? 0 : stage.cards)),
    won: add((stage) => (stage.isWon ? stage.cards : 0)),
    lost: add((stage) => (stage.isLost ? stage.cards : 0)),
  };
}

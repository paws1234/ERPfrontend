/**
 * T-6.ANALYTICS.01 — what the dashboard shows, decided here rather than in the page.
 *
 * A dashboard is where a number gets believed, so this module is the part that can be tested
 * without a browser: which tiles a reader sees, what each figure means, whether the tile is
 * reconciled, and how the rows behind a figure are presented. The page lays this out; it
 * decides nothing about what a figure says.
 *
 * Three states a reader must never confuse, and which the API keeps distinct:
 *
 * * **a tile with figures** — the number, and the verdict of the reconciliation beside it;
 * * **a withheld tile** — named, with the refusal, and **no** figure: not zero, which is a
 *   figure, and not blank, which is a rendering accident;
 * * **a tile that cannot reconcile** — the figure is there and the difference is stated, so a
 *   reader sees the disagreement rather than a rounded-away one.
 */

import type { Dashboard, DashboardTile, DashboardWithheld } from "./api";

export type ReconciliationState = "balanced" | "difference" | "problem";

export interface TileView {
  code: string;
  label: string;
  capability: string;
  /** The figures as rows of label → value, in the order the API stated them. */
  figures: { label: string; value: string }[];
  reconciliation: { state: ReconciliationState; sentence: string };
  /** The request that opens this tile's rows in one step. */
  drillDown: string;
  rows: { label: string; value: string }[];
  rowCount: number;
  truncated: boolean;
}

const MONEY_LABELS: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  net_profit: "Net profit",
  value: "Value on hand",
  items: "Items on hand",
  costing_method: "Costing method",
  open_documents: "Open documents",
  as_of: "As at",
};

function label(key: string): string {
  return MONEY_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The figures of one tile, flattened for display: currency by currency where it has any. */
export function figuresOf(tile: DashboardTile): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(tile.figures)) {
    if (key === "problems" || key === "currencies") continue;
    if (value === null || value === undefined) continue;
    rows.push({ label: label(key), value: String(value) });
  }
  const currencies = tile.figures.currencies as
    | Record<string, Record<string, unknown>>
    | undefined;
  for (const [currency, figures] of Object.entries(currencies ?? {})) {
    rows.push({
      label: `Outstanding (${currency})`,
      value: String(figures.outstanding),
    });
    rows.push({
      label: `Control account (${currency})`,
      value: String(figures.control),
    });
  }
  const problems = tile.figures.problems as { item: string; problem: string }[] | undefined;
  for (const problem of problems ?? []) {
    rows.push({ label: `${problem.item} — not valued`, value: problem.problem });
  }
  return rows;
}

/** The reconciliation verdict, in a sentence a reader can act on. */
export function reconciliationOf(tile: DashboardTile): {
  state: ReconciliationState;
  sentence: string;
} {
  const against = tile.reconciled_to.against;
  const difference = tile.reconciled_to.difference;
  const problem = tile.reconciled_to.problem;
  if (tile.reconciled_to.balanced === true) {
    return {
      state: "balanced",
      sentence: `Reconciled to ${against}${difference ? ` (difference ${difference})` : ""}`,
    };
  }
  if (problem) {
    // A tile that cannot be reconciled at all says why rather than showing a bare figure.
    return { state: "problem", sentence: `Not reconciled: ${problem}` };
  }
  return {
    state: "difference",
    sentence: `Not reconciled to ${against}: ${difference ?? "unknown"} difference`,
  };
}

/** The rows behind a figure, flattened to label → value, with the bound stated. */
export function rowsOf(tile: DashboardTile): { label: string; value: string }[] {
  return (tile.basis ?? []).map((row) => {
    const parts = Object.values(row).filter(
      (value) => value !== null && value !== undefined && value !== "",
    );
    return {
      label: String(parts[0] ?? ""),
      value: parts
        .slice(1)
        .map((value) => String(value))
        .join(" · "),
    };
  });
}

/** One tile, ready to render. `drillDown` names the tile the reader asked to open. */
export function tileView(tile: DashboardTile, drillDown?: string): TileView {
  return {
    code: tile.code,
    label: tile.label,
    capability: tile.capability,
    figures: figuresOf(tile),
    reconciliation: reconciliationOf(tile),
    drillDown: `/dashboard?drill_down=${encodeURIComponent(tile.code)}`,
    rows: drillDown === tile.code ? rowsOf(tile) : [],
    rowCount: tile.basis_rows ?? 0,
    truncated: tile.basis_truncated === true,
  };
}

/** What the page renders: the tiles a reader sees, and the ones they do not. */
export interface DashboardView {
  asOf: string;
  start: string;
  readAt: string;
  tiles: TileView[];
  withheld: DashboardWithheld[];
  opened: TileView | null;
}

export function dashboardView(
  dashboard: Dashboard,
  drillDown?: string,
): DashboardView {
  const tiles = dashboard.tiles.map((tile) => tileView(tile, drillDown));
  const opened = tiles.find((tile) => tile.code === drillDown) ?? null;
  return {
    asOf: dashboard.as_of,
    start: dashboard.start,
    readAt: dashboard.generated_at,
    tiles,
    withheld: dashboard.withheld,
    opened: opened && opened.rows.length > 0 ? opened : null,
  };
}

/** "read at 03:41:08Z" — the instant the figures were taken, which is what a reader needs. */
export function readAt(readAtInstant: string): string {
  const moment = new Date(readAtInstant);
  if (Number.isNaN(moment.getTime())) return readAtInstant;
  return `${moment.toISOString().slice(0, 19)}Z`;
}

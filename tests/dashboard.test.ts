/**
 * T-6.ANALYTICS.01 — what the dashboard page reads out of the API's payload.
 *
 * The payload below is the shape the endpoint sends: tiles with figures and the reconciliation
 * they must agree with, a tile that cannot reconcile, rows behind one figure, and tiles the
 * actor may not see — named, with the refusal, and with **no** figure. The tests' job is to
 * prove this repository keeps those apart: a withheld tile is never rendered as zero, a
 * difference is never rounded away, and the drill-down shows the count behind the list.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dashboardView,
  figuresOf,
  readAt,
  reconciliationOf,
  rowsOf,
  tileView,
} from "../lib/dashboard.ts";

const RECEIVABLES = {
  code: "finance.receivables",
  label: "Receivables outstanding as at 2026-09-30",
  capability: "invoice.read",
  figures: {
    as_of: "2026-09-30",
    open_documents: 1,
    currencies: {
      PHP: { outstanding: "1120.00", control: "1120.00", difference: "0.00", balanced: true },
    },
  },
  reconciled_to: {
    against: "the receivables control account",
    measure: "position",
    difference_total: "0.00",
    balanced: true,
    problem: null,
  },
  basis_label: "the open documents behind the balance",
  basis: null,
  basis_rows: null,
  basis_truncated: null,
};

const PROFIT = {
  code: "finance.profit_and_loss",
  label: "Profit and loss, 2026-09-01 to 2026-09-30",
  capability: "report.read",
  figures: { income: "1050.00", expenses: "400.00", net_profit: "650.00" },
  reconciled_to: {
    against: "trial_balance",
    figure: "650.00",
    difference: "0.00",
    balanced: true,
    problem: null,
  },
  basis_label: "the income and expense accounts the profit is made of",
  basis: null,
  basis_rows: null,
  basis_truncated: null,
};

const DRIFTED = {
  ...RECEIVABLES,
  figures: {
    ...RECEIVABLES.figures,
    currencies: {
      PHP: { outstanding: "1120.00", control: "1370.00", difference: "-250.00", balanced: false },
    },
  },
  reconciled_to: {
    ...RECEIVABLES.reconciled_to,
    difference: "-250.00",
    difference_total: "250.00",
    balanced: false,
  },
};

const UNMAPPED = {
  ...RECEIVABLES,
  reconciled_to: {
    against: "the inventory control account",
    problem: "no account is mapped for 'inventory' in this company",
    balanced: false,
  },
};

test("a withheld tile is named with its capability and carries no figure", () => {
  const view = dashboardView(
    {
      as_of: "2026-09-30",
      start: "2026-09-01",
      generated_at: "2026-09-30T03:41:08.038899Z",
      drill_down: null,
      tiles: [PROFIT],
      withheld: [
        {
          code: "finance.receivables",
          label: "Receivables",
          capability: "invoice.read",
          reason: "'vera' may not 'invoice.read' (holds viewer)",
        },
      ],
    },
    undefined,
  );
  assert.deepEqual(
    view.tiles.map((tile) => tile.code),
    ["finance.profit_and_loss"],
  );
  assert.equal(view.withheld.length, 1);
  assert.equal(view.withheld[0].capability, "invoice.read");
  assert.match(view.withheld[0].reason, /may not/);
  // Nothing of the withheld tile is rendered, not even an empty row or a zero.
  assert.equal(view.opened, null);
  const rendered = JSON.stringify(view);
  assert.ok(!rendered.includes("outstanding"), rendered);
});

test("the tiles say what they reconcile to, and a difference is not rounded away", () => {
  assert.equal(reconciliationOf(PROFIT).state, "balanced");
  assert.match(reconciliationOf(PROFIT).sentence, /Reconciled to trial_balance/);
  assert.equal(reconciliationOf(DRIFTED).state, "difference");
  assert.match(reconciliationOf(DRIFTED).sentence, /Not reconciled to the receivables control account/);
  assert.match(reconciliationOf(DRIFTED).sentence, /-250.00 difference/);
  assert.equal(reconciliationOf(UNMAPPED).state, "problem");
  assert.match(reconciliationOf(UNMAPPED).sentence, /no account is mapped/);
  // The figure itself is untouched by the disagreement: the invoices did not change.
  assert.deepEqual(
    figuresOf(DRIFTED).find((figure) => figure.label === "Outstanding (PHP)"),
    { label: "Outstanding (PHP)", value: "1120.00" },
  );
});

test("a figure opens onto its rows, and the bound is stated", () => {
  const opened = {
    ...PROFIT,
    basis: [
      { account: "4000", name: "Sales Revenue", amount: "1050.00", class: "income" },
      { account: "5200", name: "Rent Expense", amount: "400.00", class: "expense" },
    ],
    basis_rows: 2,
    basis_truncated: false,
  };
  const tile = tileView(opened, "finance.profit_and_loss");
  assert.equal(tile.drillDown, "/dashboard?drill_down=finance.profit_and_loss");
  assert.equal(tile.rows.length, 2);
  assert.equal(tile.rows[0].label, "4000");
  assert.equal(tile.rowCount, 2);
  assert.equal(tile.truncated, false);
  // Rows are shown only for the tile the reader asked to open.
  const other = tileView(opened, "finance.payables");
  assert.deepEqual(other.rows, []);
  assert.equal(rowsOf(opened).length, 2);
});

test("the payload's own instant is what the page states", () => {
  assert.equal(readAt("2026-09-30T03:41:08.038899Z"), "2026-09-30T03:41:08Z");
  // An unreadable instant is shown as it arrived rather than as "Invalid Date".
  assert.equal(readAt("not an instant"), "not an instant");
});

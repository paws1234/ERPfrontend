/**
 * T-6.OFFLINE.01 — the terminal's queue: what it keeps, what it refuses, and what a
 * report leaves behind.
 *
 * The store below is the browser's own shape (get/set on a key), so the tests drive the
 * real queue logic against a stand-in the way the till drives it against `localStorage`.
 * The reports are what the endpoint answers — the wrapped shape, counts as numbers — so
 * the reader is held to what actually arrives rather than to a convenient object.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createQueue,
  oversellAllowed,
  parseStock,
  readReport,
  syncBody,
  type Store,
} from "../lib/offline.ts";

/** A terminal's storage, in memory: the same keyed shape `localStorage` offers. */
function store(): Store {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
  };
}

const REPORT = {
  report: {
    terminal: "TILL-1",
    queued: 2,
    accepted: 1,
    duplicates: 1,
    rejected: 1,
    outcomes: [
      { number: "TILL-1-000001", outcome: "accepted" },
      { number: "TILL-1-000002", outcome: "duplicate" },
      {
        number: "TILL-1-000003",
        outcome: "rejected",
        reason: "the location cannot issue what the till sold: WIDGET wants 600.000000",
      },
    ],
    differences: [
      {
        number: "TILL-1-000003",
        item: "WIDGET",
        barcode: "4000000000017",
        quantity: "600.000000",
        on_hand: "492.000000",
        location: "TILL-1",
        oversell_allowed: false,
      },
    ],
  },
};

test("a queue outlives the terminal it was written on", () => {
  const held = store();
  const till = createQueue(held);
  till.count("4000000000017=12");
  till.add({
    number: till.next("TILL-1"),
    lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "2" }],
    tenders: [{ tender_type: "cash", amount: "28.00" }],
  });

  // A reload, a power cut: a new queue over the same storage.
  const restarted = createQueue(held);
  assert.equal(restarted.pending().length, 1);
  assert.equal(restarted.pending()[0]?.number, "TILL-1-000001");
  assert.deepEqual(restarted.cached(), { "4000000000017": "12.000000" });
  // The next sale does not re-use the number the last one took.
  assert.equal(restarted.next("TILL-1"), "TILL-1-000002");
});

test("the shelf the till can see is what it will not oversell", () => {
  const till = createQueue(store());
  till.count("4000000000017=2");
  assert.deepEqual(parseStock("4000000000017=2\n4000000000024=ten"), {
    "4000000000017": "2.000000",
  });

  const fits = till.canSell("4000000000017", "2", false);
  assert.equal(fits.ok, true);
  till.spend("4000000000017", "2");
  assert.deepEqual(till.cached(), { "4000000000017": "0.000000" });

  const beyond = till.canSell("4000000000017", "1", false);
  assert.equal(beyond.ok, false);
  assert.match(beyond.reason, /counted at 0\.000000; selling 1\.000000 would leave nothing/);

  // Explicitly configured to allow it: the sale goes out, and the reason says why.
  const allowed = till.canSell("4000000000017", "1", true);
  assert.equal(allowed.ok, true);
  assert.match(allowed.reason, /allowed by policy/);

  // A code nobody counted is not a code with nothing on the shelf: it is unknown.
  const unknown = till.canSell("4000000000024", "1", false);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /no shelf count/);
  assert.equal(parseStock("4000000000024=ten")["4000000000024"], undefined);
});

test("the policy is read as the configuration states it, and never assumed", () => {
  assert.equal(oversellAllowed("true"), true);
  assert.equal(oversellAllowed(" 1 "), true);
  assert.equal(oversellAllowed("yes"), true);
  assert.equal(oversellAllowed("false"), false);
  assert.equal(oversellAllowed(""), false);
  assert.equal(oversellAllowed(undefined), false);
});

test("the sync body is the queue in order, with the policy the till traded under", () => {
  const till = createQueue(store());
  till.add({
    number: "TILL-1-000001",
    sold_on: "2026-09-20",
    lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "2" }],
    tenders: [{ tender_type: "cash", amount: "28.00" }],
  });
  till.add({
    number: "TILL-1-000002",
    lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "1" }],
    tenders: [{ tender_type: "card", amount: "14.00", reference: "AUTH-1" }],
  });

  assert.deepEqual(syncBody("TILL-1", "MAIN-T1", false, till.pending()), {
    terminal: "TILL-1",
    location_code: "MAIN-T1",
    oversell_allowed: false,
    sales: [
      {
        number: "TILL-1-000001",
        sold_on: "2026-09-20",
        lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "2" }],
        tenders: [{ tender_type: "cash", amount: "28.00" }],
      },
      {
        number: "TILL-1-000002",
        lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "1" }],
        tenders: [{ tender_type: "card", amount: "14.00", reference: "AUTH-1" }],
      },
    ],
  });
});

test("a report takes the accepted and stored numbers out of the queue and keeps the rest", () => {
  const till = createQueue(store());
  for (const number of ["TILL-1-000001", "TILL-1-000002", "TILL-1-000003"]) {
    till.add({
      number,
      lines: [{ barcode: "4000000000017", base_price: "12.50", quantity: "1" }],
      tenders: [{ tender_type: "cash", amount: "14.00" }],
    });
  }

  const applied = till.apply(REPORT.report);
  assert.equal(applied?.accepted, 1);
  assert.equal(applied?.duplicates, 1);
  assert.equal(applied?.rejected, 1);
  // Exactly one sale is left: the one the server refused, and it is still readable after
  // a reload because the report is stored as it arrived.
  assert.deepEqual(
    till.pending().map((sale) => sale.number),
    ["TILL-1-000003"],
  );
  assert.deepEqual(
    createQueue(store()).lastReport(),
    null,
    "a fresh storage has no report to show",
  );
  assert.equal(till.lastReport()?.differences[0]?.onHand, "492.000000");
  assert.equal(
    till.lastReport()?.outcomes.get("TILL-1-000003")?.reason,
    "the location cannot issue what the till sold: WIDGET wants 600.000000",
  );
});

test("a report that is not one is not read as zeros", () => {
  assert.equal(readReport(null), null);
  assert.equal(readReport({ error: { code: "pos_error" } }), null);
  assert.equal(readReport({ terminal: "TILL-1", queued: 1 }), null);
  assert.equal(readReport(REPORT.report)?.queued, 2);
});

/**
 * The till's logic: what an amount is, what change reads as, what the tenders add up
 * to, and what a receipt actually says.
 *
 * The payloads below are exactly what the endpoints send: money as decimal **strings**
 * at the platform's six-decimal scale, the receipt and the Z-report as open objects of
 * whatever the API assembled. The tests' job is to prove the till keeps amounts exact,
 * never reads an unreadable figure as zero, and never lets a tender it could not read
 * settle a sale — and that every call goes to the path the contract states.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { NotPermitted } from "../lib/api.ts";
import {
  amount,
  amountLabel,
  changeDisplay,
  completeSale,
  currentShift,
  dayReport,
  isMovementType,
  isOpen,
  isTenderType,
  openSale,
  receiptRows,
  reportRows,
  saleReceipt,
  saleTotals,
  scanItem,
  setCashDrawerPolicy,
  shiftReport,
  summariseTenders,
  takeTender,
  voidSale,
  type PosSale,
} from "../lib/pos.ts";

const IDENTITY = { companyId: "11111111-1111-1111-1111-111111111111", actor: "alice" };

/** A sale as the POS endpoints state one, with nothing on it to begin with. */
function sale(overrides: Partial<PosSale> = {}): PosSale {
  return {
    number: "POS-1",
    terminal: "TILL-1",
    status: "open",
    sold_on: "2026-10-07",
    currency: "USD",
    shift: "shift-1",
    net: "100.000000",
    tax: "15.000000",
    total: "115.000000",
    tendered: "0.000000",
    change: "0.000000",
    lines: [],
    tenders: [],
    ...overrides,
  };
}

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

test("an amount is exact at the money scale, and a non-amount is not a zero", () => {
  assert.deepEqual(amount("120000"), { text: "120000.000000", units: 120000000000n });
  assert.equal(amount("1.5")?.text, "1.500000");
  assert.equal(amount(" 12.50 ")?.text, "12.500000", "the API's own spacing is not a value");
  assert.equal(amount("-2.5")?.text, "-2.500000");
  assert.deepEqual(amount("0"), { text: "0.000000", units: 0n });

  // Seven decimals is contract drift, not money: dropping the seventh silently is the
  // same class of loss as reading money through Number.
  assert.equal(amount("1.0000005"), null);
  assert.equal(amount(""), null, "the empty string is not zero");
  assert.equal(amount("n/a"), null);
  assert.equal(amount("1,200.00"), null);
  assert.equal(amount(12), null, "a JSON number is not the contract's money");
  assert.equal(amount(null), null);
  assert.equal(amountLabel(null), "not an amount");
  assert.equal(amountLabel(amount("1.5")), "1.500000");
});

test("the sale's totals are read as the exact amounts they are", () => {
  const totals = saleTotals(sale({ net: "100.000000", tax: "15.000000", total: "115.0" }));
  assert.equal(amountLabel(totals.net), "100.000000");
  assert.equal(amountLabel(totals.tax), "15.000000");
  assert.equal(amountLabel(totals.total), "115.000000");
  assert.equal(amountLabel(totals.change), "0.000000");
});

test("change reads in words, and an under-tender is not a rounding of zero", () => {
  assert.equal(changeDisplay(amount("0")), "no change due");
  assert.equal(changeDisplay(amount("2.5")), "change due 2.500000");
  assert.equal(changeDisplay(amount("-1")), "short by 1.000000");
  assert.equal(changeDisplay(null), "change not an amount");
});

test("tenders are summed exactly, per type, and binary floating point is not used", () => {
  const summary = summariseTenders(
    sale({
      tendered: "60.000000",
      total: "60.000000",
      tenders: [
        { tender_no: 1, tender_type: "cash", tendered: "0.1", applied: "0.1", reference: null },
        { tender_no: 2, tender_type: "cash", tendered: "0.2", applied: "0.2", reference: null },
        {
          tender_no: 3,
          tender_type: "card",
          tendered: "59.7",
          applied: "59.7",
          reference: "auth-1",
        },
      ],
    }),
  );

  assert.equal(summary.byType.length, 2);
  assert.deepEqual(
    summary.byType.map((line) => line.tenderType),
    ["cash", "card"],
    "types keep the order the sale stated them in",
  );
  assert.equal(summary.byType[0].count, 2);
  // 0.1 + 0.2 in binary floating point is 0.30000000000000004
  assert.equal(summary.byType[0].tendered.text, "0.300000");
  assert.equal(summary.byType[0].tendered.units, 300000n);
  assert.equal(summary.tendered.text, "60.000000", "every tender on the sale, added exactly");
  assert.equal(summary.applied.text, "60.000000");
  assert.equal(summary.owed?.text, "0.000000");
  assert.equal(summary.invalid, 0);
  assert.equal(summary.settled, true);
});

test("a tender the till cannot read settles nothing and is not counted as zero", () => {
  const summary = summariseTenders(
    sale({
      total: "115.000000",
      tenders: [
        { tender_no: 1, tender_type: "cash", tendered: "115.0", applied: "115.0", reference: null },
        // A gateway answer the till cannot read: half a tender is not a tender.
        {
          tender_no: 2,
          tender_type: "gateway",
          tendered: "10.00",
          applied: "n/a",
          reference: "gw-9",
        },
      ],
    }),
  );

  assert.equal(summary.applied.text, "115.000000", "the readable tender is all that counts");
  assert.equal(summary.tendered.text, "115.000000");
  assert.equal(summary.invalid, 1, "the unreadable tender is reported apart");
  assert.equal(summary.byType[1].invalid, 1);
  assert.equal(summary.byType[1].applied.text, "0.000000");
  assert.equal(summary.settled, false, "a sale with a tender nobody could read is not settled");
});

test("over-tendering is settled, and what was over comes back as change", () => {
  const summary = summariseTenders(
    sale({
      total: "100.000000",
      tenders: [
        { tender_no: 1, tender_type: "cash", tendered: "120.0", applied: "100.0", reference: null },
      ],
    }),
  );
  assert.equal(summary.applied.text, "100.000000");
  assert.equal(summary.owed?.text, "0.000000");
  assert.equal(summary.settled, true);
});

test("a sale with no readable total is never settled", () => {
  const summary = summariseTenders(
    sale({
      total: "n/a",
      tenders: [
        { tender_no: 1, tender_type: "cash", tendered: "5.0", applied: "5.0", reference: null },
      ],
    }),
  );
  assert.equal(summary.total, null);
  assert.equal(summary.owed, null, "what is owed is unknown, not zero");
  assert.equal(summary.settled, false);
});

test("an empty sale summarises to nothing rather than throwing", () => {
  const summary = summariseTenders(sale());
  assert.deepEqual(summary.byType, []);
  assert.equal(summary.tendered.text, "0.000000");
  assert.equal(summary.applied.text, "0.000000");
  assert.equal(summary.invalid, 0);
  assert.equal(summary.settled, false, "a basket with nothing on it is not paid");
});

test("a basket worth nothing is not settled, however its tenders read", () => {
  const opened = sale({ total: "0.000000", net: "0.000000", tax: "0.000000" });
  const summary = summariseTenders(opened);
  assert.equal(summary.settled, false, "0 >= 0 is not payment");
  assert.equal(summary.owed?.text, "0.000000");
  // A tender against a basket worth nothing is not settlement either.
  const tendered = summariseTenders(
    sale({
      total: "0.000000",
      net: "0.000000",
      tax: "0.000000",
      tenders: [
        { tender_no: 1, tender_type: "cash", tendered: "10.000000", applied: "0.000000", reference: null },
      ],
    }),
  );
  assert.equal(tendered.settled, false, "nothing to pay is not paid");
});

test("a sale that has ended takes no more scans", () => {
  assert.equal(isOpen(sale()), true);
  assert.equal(isOpen(sale({ status: "completed" })), false);
  assert.equal(isOpen(sale({ status: "void" })), false);
});

test("the tender and movement types the till offers are the ones the domain states", () => {
  assert.equal(isTenderType("cash"), true);
  assert.equal(isTenderType("card"), true);
  assert.equal(isTenderType("gateway"), true);
  assert.equal(isTenderType("cheque"), false);
  assert.equal(isMovementType("paid_in"), true);
  assert.equal(isMovementType("paid_out"), true);
  assert.equal(isMovementType("withdrawn"), false);
});

test("a receipt's totals lead the slip, and everything else keeps the API's order", () => {
  const rows = receiptRows({
    number: "POS-1",
    sold_on: "2026-10-07",
    lines: [
      { description: "Widget", quantity: "2.000000", unit_price: "10.000000" },
      { description: "Gizmo", quantity: "1", unit_price: "95.00" },
    ],
    change: "0.000000",
    tendered: "115.000000",
    total: "115.000000",
    tax: "15.000000",
    net: "100.000000",
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    [
      "net",
      "tax",
      "total",
      "tendered",
      "change",
      "number",
      "sold_on",
      "lines.0.description",
      "lines.0.quantity",
      "lines.0.unit_price",
      "lines.1.description",
      "lines.1.quantity",
      "lines.1.unit_price",
    ],
  );
  assert.deepEqual(rows[2], {
    label: "total",
    kind: "amount",
    value: { text: "115.000000", units: 115000000n },
  });
  assert.deepEqual(rows[7], { label: "lines.0.description", kind: "text", text: "Widget" });
  assert.deepEqual(rows[9], {
    label: "lines.0.unit_price",
    kind: "amount",
    value: { text: "10.000000", units: 10000000n },
  });
});

test("a receipt states a barcode verbatim — digits with no scale are not money", () => {
  const rows = receiptRows({
    lines: [
      {
        barcode: "4000000000017",
        terminal: "1",
        unit_price: "45.000000",
        reference: "123456",
      },
    ],
  });
  assert.deepEqual(rows, [
    { label: "lines.0.barcode", kind: "text", text: "4000000000017" },
    { label: "lines.0.terminal", kind: "text", text: "1" },
    {
      label: "lines.0.unit_price",
      kind: "amount",
      value: { text: "45.000000", units: 45000000n },
    },
    { label: "lines.0.reference", kind: "text", text: "123456" },
  ]);
});

test("a receipt value that is not an amount is shown as what arrived, never as zero", () => {
  const rows = receiptRows({
    total: "n/a",
    printed: "",
    copies: null,
    reprinted: false,
    rounds: 2,
  });
  assert.deepEqual(rows, [
    { label: "total", kind: "text", text: "n/a" },
    { label: "printed", kind: "empty" },
    { label: "copies", kind: "empty" },
    { label: "reprinted", kind: "text", text: "false" },
    { label: "rounds", kind: "text", text: "2" },
  ]);
  assert.deepEqual(receiptRows({}), [], "a receipt with nothing on it reads as nothing");
});

test("a Z-report reads exactly, nested as the API states it", () => {
  const rows = reportRows({
    opened_on: "2026-10-07",
    cash: { tendered: "300.000000", counted: "312.40" },
    by_terminal: [{ terminal: "TILL-1", sales: 3, total: "115.000000" }],
  });
  assert.deepEqual(
    rows.map((row) => row.label),
    [
      "opened_on",
      "cash.tendered",
      "cash.counted",
      "by_terminal.0.terminal",
      "by_terminal.0.sales",
      "by_terminal.0.total",
    ],
  );
  assert.deepEqual(rows[2], {
    label: "cash.counted",
    kind: "amount",
    value: { text: "312.400000", units: 312400000n },
  });
  assert.deepEqual(rows[4], { label: "by_terminal.0.sales", kind: "text", text: "3" });
});

test("a sale is rung up on the contract's own path, with the company it is for", async () => {
  const calls = stubFetch(201, sale());
  await openSale(IDENTITY, {
    number: "POS-1",
    terminal: "TILL-1",
    locationCode: "MAIN",
    customerCode: "C-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:8000/api/v1/pos/sales");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["X-Company-Id"], IDENTITY.companyId);
  assert.equal(headers["X-Actor"], IDENTITY.actor);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    number: "POS-1",
    terminal: "TILL-1",
    location_code: "MAIN",
    customer_code: "C-1",
  });
});

test("scanning, tendering and completing speak the sale's own number", async () => {
  const calls = stubFetch(200, sale());
  await scanItem(IDENTITY, "POS/1", { barcode: "BC-1", basePrice: "12.50", quantity: "2" });
  await takeTender(IDENTITY, "POS/1", { tenderType: "card", amount: "25.00" });
  await completeSale(IDENTITY, "POS/1");
  await voidSale(IDENTITY, "POS/1", "customer walked away");

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://localhost:8000/api/v1/pos/sales/POS%2F1/scan",
      "http://localhost:8000/api/v1/pos/sales/POS%2F1/tender",
      "http://localhost:8000/api/v1/pos/sales/POS%2F1/complete",
      "http://localhost:8000/api/v1/pos/sales/POS%2F1/void",
    ],
    "a sale number with a slash in it is a path segment, not two paths",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    barcode: "BC-1",
    base_price: "12.50",
    quantity: "2",
  });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    tender_type: "card",
    amount: "25.00",
  });
  assert.equal(calls[2].init.body, undefined, "completing a sale states nothing but the sale");
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), { reason: "customer walked away" });
});

test("the receipt comes back unwrapped, and a refusal is the client's own type", async () => {
  stubFetch(200, { receipt: { number: "POS-1", total: "115.000000" } });
  assert.deepEqual(await saleReceipt(IDENTITY, "POS-1"), {
    number: "POS-1",
    total: "115.000000",
  });

  stubFetch(403, {
    error: { code: "forbidden", message: "'alice' may not 'pos.tender'", details: null },
  });
  await assert.rejects(
    () => takeTender(IDENTITY, "POS-1", { tenderType: "cash", amount: "10.00" }),
    (error: unknown) => {
      assert.ok(error instanceof NotPermitted);
      assert.equal(error.message, "'alice' may not 'pos.tender'");
      return true;
    },
    "a till refusal arrives as the 403 the shell already knows how to explain",
  );
});

test("the shift, the drawer and the reports are read on their own paths", async () => {
  const calls = stubFetch(200, { id: "shift-1", report: {} });
  await currentShift(IDENTITY, "TILL 1");
  await shiftReport(IDENTITY, "shift-1");
  await dayReport(IDENTITY, "2026-10-07");
  await setCashDrawerPolicy(IDENTITY, null);

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://localhost:8000/api/v1/pos/shifts/current?terminal=TILL%201",
      "http://localhost:8000/api/v1/pos/z-reports/shift/shift-1",
      "http://localhost:8000/api/v1/pos/z-reports/day?on=2026-10-07",
      "http://localhost:8000/api/v1/pos/cash-drawer-policy",
    ],
  );
  assert.deepEqual(
    JSON.parse(String(calls[3].init.body)),
    { required: null },
    "withdrawing the policy is stated, not omitted",
  );
});

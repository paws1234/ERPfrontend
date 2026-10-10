/**
 * T-6.PORTAL.01 — what a supplier's page reads out of its own payload.
 *
 * The payload below is the shape the endpoint sends: an open `documents` object, lists that
 * may be empty, and fields that may be absent (a restriction hid them) or null (nothing was
 * ever recorded). The tests' job is to prove this repository keeps those apart, counts nothing
 * it was not given, and refuses a quote with a line missing before the network is asked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { readPortal, responseLines, type PortalView } from "../lib/portal.ts";

const DOCUMENTS = {
  supplier: { code: "ACME", name: "Acme Supplies" },
  subject: "acme.portal",
  rfqs: [
    {
      number: "RFQ-1",
      issued_on: "2026-10-01",
      response_deadline: "2026-10-20",
      currency: "PHP",
      lines: [
        { line_no: 1, description: "Laptops", quantity: "20.000000", uom: "each" },
        { line_no: 2, description: "Monitors", quantity: "40.000000", uom: "each" },
      ],
      answered: false,
      answered_on: null,
    },
    {
      number: "RFQ-2",
      issued_on: null,
      response_deadline: "2026-11-01",
      lines: [{ line_no: 1, description: "Cables", quantity: "ten", uom: "each" }],
      answered: true,
      answered_on: "2026-10-05",
    },
  ],
  orders: [
    {
      number: "PO-1",
      status: "approved",
      required_date: "2026-11-15",
      currency: "PHP",
      total: "10000.000000",
      revision_no: 1,
      lines: [{ line_no: 1 }, { line_no: 2 }],
    },
    {
      number: "PO-2",
      status: "acknowledged",
      required_date: "2026-11-20",
      currency: "PHP",
      total: "5025.000000",
      lines: [{ line_no: 1 }],
    },
  ],
  invoices: [
    {
      number: "INV-1",
      status: "draft",
      invoice_date: "2026-10-01",
      due_date: "2026-10-31",
      currency: "PHP",
      gross_amount: "10000.000000",
    },
  ],
};

test("a supplier's payload reads as its own documents, counted", () => {
  const view = readPortal(DOCUMENTS);
  assert.notEqual(view, null);
  assert.equal(view?.supplier?.code, "ACME");
  assert.deepEqual(view?.supplier?.name, { kind: "value", value: "Acme Supplies" });
  assert.deepEqual(view?.summary, {
    rfqs: 2,
    orders: 2,
    invoices: 1,
    awaitingAnswer: 1,
  });
  assert.equal(view?.rfqs[0]?.lines.length, 2);
  assert.equal(view?.rfqs[1]?.answered, true);
  assert.equal(view?.orders[1]?.acknowledged, true);
  assert.equal(view?.orders[0]?.acknowledged, false);
  assert.equal(view?.invoices[0]?.status.kind === "value" ? view.invoices[0].status.value : "", "draft");
});

test("a field is withheld, unset or a value — three states, never one", () => {
  const view = readPortal(DOCUMENTS);
  // Present and null: the RFQ was never dated.
  assert.deepEqual(view?.rfqs[1]?.issuedOn, { kind: "unset" });
  // Present and null: nobody answered it.
  assert.deepEqual(view?.rfqs[0]?.answeredOn, { kind: "unset" });
  // A price nobody can read is not a zero.
  assert.equal(view?.rfqs[1]?.lines[0]?.quantity, null);
  assert.equal(view?.rfqs[0]?.lines[0]?.quantity?.text, "20.000000");
  // A key that is not there at all is withheld rather than unset.
  const hid = readPortal({
    ...DOCUMENTS,
    orders: [{ number: "PO-3", lines: [] }],
  });
  assert.deepEqual(hid?.orders[0]?.status, { kind: "withheld" });
  assert.deepEqual(hid?.orders[0]?.currency, { kind: "withheld" });
  assert.equal(hid?.orders[0]?.total, null);
});

test("a payload that is not a portal payload is not read as an empty one", () => {
  assert.equal(readPortal(null), null);
  assert.equal(readPortal({ error: { code: "no_portal_account" } }), null);
  assert.equal(readPortal([]), null);
  // A supplier with nothing yet is a payload, and reads as nothing yet.
  const empty = readPortal({
    supplier: { code: "ACME", name: "Acme Supplies" },
    rfqs: [],
    orders: [],
    invoices: [],
  });
  assert.deepEqual(empty?.summary, { rfqs: 0, orders: 0, invoices: 0, awaitingAnswer: 0 });
});

test("a quote with a line missing is refused, naming the line", () => {
  const view = readPortal(DOCUMENTS) as PortalView;
  const rfq = view.rfqs[0]!;
  const short = responseLines(rfq, { "1": "1000.00", "2": "" });
  assert.ok("refused" in short);
  assert.match(short.refused, /line 2 has no price/);

  const unreadable = responseLines(rfq, { "1": "1000.00", "2": "about a thousand" });
  assert.ok("refused" in unreadable);
  assert.match(unreadable.refused, /about a thousand, which is not a price/);

  const negative = responseLines(rfq, { "1": "-1.00", "2": "250.00" });
  assert.ok("refused" in negative);
  assert.match(negative.refused, /not a price/);
});

test("a complete quote is exact, in the contract's own shape", () => {
  const view = readPortal(DOCUMENTS) as PortalView;
  const quoted = responseLines(view.rfqs[0]!, { "1": "1000.00", "2": "250" });
  assert.ok("lines" in quoted);
  assert.deepEqual(quoted.lines, [
    { line_no: 1, unit_price: "1000.000000" },
    { line_no: 2, unit_price: "250.000000" },
  ]);
  // The same reader the money rule uses: a string, never a float.
  assert.equal(typeof quoted.lines[0]?.unit_price, "string");
});

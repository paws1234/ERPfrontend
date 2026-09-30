/**
 * T-2.PROC.04 check — the comparative statement matrix, its basis and its export.
 *
 *   node --experimental-strip-types --test tests/
 *
 * It fails if any of these stops holding:
 *
 * 1. every responding supplier appears per line with its quoted values, **converted
 *    to the base currency** and with the tax-inclusive figure the configured rate
 *    implies — and the extended total is the tax-inclusive price × the quantity
 * 2. the comparison **labels its basis**: the base currency, the date of the rate
 *    and the tax rate (or that there is none), on the matrix and on every CSV row
 * 3. a supplier that **did not respond** is distinguishable from one that **quoted
 *    zero** and from one that answered and said nothing about that line
 * 4. a late answer is still compared, and is flagged as late rather than hidden
 * 5. the money arithmetic is **exact** — no binary floating point anywhere: a value
 *    that a float would misround comes out of the matrix right, with every
 *    intermediate result held at the fixed money scale
 * 6. the export is a usable CSV: one row per supplier per line, quoted fields where
 *    a description carries a comma, and every line carrying the basis
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  basisLabel,
  buildComparison,
  comparisonCsv,
  multiply,
  taxInclusive,
  type RfqView,
} from "../lib/comparison.ts";

function rfq(overrides: Partial<RfqView> = {}): RfqView {
  return {
    number: "RFQ-100",
    requisition: "REQ-100",
    currency: "PHP",
    issued_on: "2026-10-01",
    response_deadline: "2026-10-10",
    status: "issued",
    basis: {
      base_currency: "PHP",
      fx_on: "2026-10-01",
      tax_rule_code: "VAT-IN-12",
      tax_rate_percent: "12",
      tax_inclusive: true,
    },
    lines: [
      {
        line_no: 1,
        requisition_line_no: 1,
        description: "Laptops, 14 inch",
        quantity: "20.000000",
        uom: "each",
      },
      {
        line_no: 2,
        requisition_line_no: 2,
        description: "Monitors",
        quantity: "40.000000",
        uom: "each",
      },
    ],
    suppliers: [
      {
        code: "ACME",
        name: "Acme Supplies",
        responded: true,
        late: false,
        received_on: "2026-10-05",
        lead_time_days: 21,
        valid_until: "2026-11-15",
        lines: [
          {
            line_no: 1,
            unit_price: "980.000000",
            currency: "PHP",
            fx_rate: "1.0000000000",
            base_unit_price: "980.000000",
          },
          {
            line_no: 2,
            unit_price: "255.500000",
            currency: "PHP",
            fx_rate: "1.0000000000",
            base_unit_price: "255.500000",
          },
        ],
      },
      {
        code: "BOREAL",
        name: "Boreal Trading",
        responded: true,
        late: true,
        received_on: "2026-10-14",
        lead_time_days: null,
        valid_until: null,
        lines: [
          {
            line_no: 1,
            unit_price: "17.000000",
            currency: "USD",
            fx_rate: "58.5000000000",
            base_unit_price: "994.500000",
          },
        ],
      },
      {
        code: "CHIRP",
        name: "Chirp Industrial",
        responded: false,
        late: false,
        received_on: null,
        lead_time_days: null,
        valid_until: null,
        lines: [],
      },
    ],
    ...overrides,
  };
}

test("every responding supplier appears per line, converted and tax-inclusive", () => {
  const comparison = buildComparison(rfq());
  const [first, second] = comparison.rows;

  assert.deepEqual(comparison.suppliers, ["ACME", "BOREAL", "CHIRP"]);

  const acme = first.cells[0];
  assert.equal(acme.status, "quoted");
  assert.equal(acme.quotedUnitPrice, "980.000000");
  assert.equal(acme.baseUnitPrice, "980.000000");
  assert.equal(acme.taxInclusiveUnitPrice, "1097.600000");
  assert.equal(acme.extended, "21952.000000");
  assert.equal(acme.leadTimeDays, 21);
  assert.equal(acme.validUntil, "2026-11-15");

  const boreal = first.cells[1];
  assert.equal(boreal.quotedUnitPrice, "17.000000");
  assert.equal(boreal.currency, "USD");
  assert.equal(boreal.baseUnitPrice, "994.500000");
  assert.equal(boreal.taxInclusiveUnitPrice, "1113.840000");

  // the second line: ACME quoted it, BOREAL did not mention it, CHIRP never answered
  assert.equal(second.cells[0].status, "quoted");
  assert.equal(second.cells[1].status, "no_quote");
  assert.equal(second.cells[2].status, "did_not_respond");
});

test("the comparison labels its basis, wherever it is read", () => {
  const comparison = buildComparison(rfq());
  assert.equal(
    comparison.label,
    "Amounts in PHP, converted at the rate for 2026-10-01 — tax-inclusive at 12% VAT-IN-12 — one row per supplier per line",
  );
  const csv = comparisonCsv(comparison);
  for (const row of csv.trimEnd().split("\n").slice(1)) {
    assert.ok(row.includes(comparison.label), `a row lost its basis: ${row}`);
  }
  assert.equal(
    basisLabel({
      base_currency: "PHP",
      fx_on: "2026-10-01",
      tax_rule_code: null,
      tax_rate_percent: null,
      tax_inclusive: false,
    }),
    "Amounts in PHP, converted at the rate for 2026-10-01 — tax-exclusive (no procurement tax rate is configured) — one row per supplier per line",
  );
});

test("did not respond ≠ quoted zero ≠ said nothing about the line", () => {
  const zero = rfq({
    suppliers: [
      {
        code: "FREEBIE",
        name: "Freebie Co",
        responded: true,
        late: false,
        received_on: "2026-10-05",
        lead_time_days: 0,
        valid_until: null,
        lines: [
          {
            line_no: 1,
            unit_price: "0.000000",
            currency: "PHP",
            fx_rate: "1.0000000000",
            base_unit_price: "0.000000",
          },
        ],
      },
      {
        code: "CHIRP",
        name: "Chirp Industrial",
        responded: false,
        late: false,
        received_on: null,
        lead_time_days: null,
        valid_until: null,
        lines: [],
      },
      {
        code: "SILENT",
        name: "Silent Supplies",
        responded: true,
        late: false,
        received_on: "2026-10-06",
        lead_time_days: 10,
        valid_until: null,
        lines: [
          {
            line_no: 2,
            unit_price: "10.000000",
            currency: "PHP",
            fx_rate: "1.0000000000",
            base_unit_price: "10.000000",
          },
        ],
      },
    ],
  });
  const comparison = buildComparison(zero);
  const first = comparison.rows[0];

  assert.equal(first.cells[0].status, "quoted");
  assert.equal(first.cells[0].taxInclusiveUnitPrice, "0.000000");
  assert.equal(first.cells[1].status, "did_not_respond");
  assert.equal(first.cells[2].status, "no_quote");
  assert.deepEqual(comparison.nonResponders, ["CHIRP"]);
});

test("a late answer is compared and flagged, not hidden", () => {
  const comparison = buildComparison(rfq());
  assert.deepEqual(comparison.lateResponders, ["BOREAL"]);
  assert.equal(comparison.rows[0].cells[1].late, true);
  assert.equal(comparison.rows[0].cells[0].late, false);
  assert.ok(comparisonCsv(comparison).includes(",true,"));
});

test("the money arithmetic is exact — no binary floating point", () => {
  // 0.1 + 0.2 in binary floating point is famously 0.30000000000000004; the same
  // figure through the money path comes out exact.
  assert.equal(multiply("0.100000", "3.000000"), "0.300000");
  // a half-up rounding case at the seventh decimal: 0.0000055 → 0.000006
  assert.equal(taxInclusive("0.000005", "10"), "0.000006");
  assert.equal(taxInclusive("0.000005", "0"), "0.000005");
  // 20 × 255.5 = 5110 exactly, and the tax-inclusive price is exact too
  assert.equal(multiply("255.500000", "20.000000"), "5110.000000");
  assert.equal(taxInclusive("255.500000", "12"), "286.160000");
  assert.equal(taxInclusive("255.500000", "12.5"), "287.437500");
  // a large amount stays exact where a float would lose the last unit
  assert.equal(taxInclusive("99999999999.999999", "12"), "111999999999.999999");
  assert.equal(multiply("123456789.123456", "1000.000000"), "123456789123.456000");
});

test("the export is a usable CSV: one row per supplier per line", () => {
  const csv = comparisonCsv(buildComparison(rfq()));
  const rows = csv.trimEnd().split("\n");
  assert.equal(rows.length, 1 + 2 * 3, "expected a header plus every cell");
  assert.ok(rows[0].startsWith("rfq,requisition,line_no,description,quantity,uom,supplier,status,"));
  assert.equal(rows.filter((row) => row.includes(",ACME,")).length, 2);
  assert.equal(rows.filter((row) => row.includes(",CHIRP,")).length, 2);
  assert.ok(rows.some((row) => row.includes(",did_not_respond,")));
  // a description with a comma is quoted, so the columns do not shift
  assert.ok(rows[1].includes('"Laptops, 14 inch"'), rows[1]);
});

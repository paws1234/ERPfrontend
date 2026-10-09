/**
 * T-5.EMP.02 — the chart's logic: what a depth means, what a missing field says, and
 * what the totals count.
 *
 * The payloads below are exactly what the endpoint sends: a field the caller's role may
 * not read simply has **no key** (T-0.SEC.01's field permissions, applied in the backend
 * before the response leaves), a field nobody recorded is `null`, and the entries arrive
 * in chart order. The tests' job is to prove this repository keeps those apart and never
 * counts somebody the tree could not draw into a department.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chartRows,
  chartSummary,
  fieldLabel,
  textState,
  unplacedRows,
  type OrgChart,
} from "../lib/org.ts";

const CHART: OrgChart = {
  as_of: "2026-06-01",
  root_number: "E-001",
  entries: [
    {
      number: "E-001",
      name: "Ana Reyes",
      manager_number: null,
      department: "Executive",
      cost_centre: "CC-0",
      depth: 1,
      reports: 1,
    },
    {
      // The viewer's role may not read the name and the department: no keys at all.
      number: "E-002",
      manager_number: "E-001",
      cost_centre: "CC-1",
      depth: 2,
      reports: 2,
    },
    {
      // A department nobody recorded: present and null.
      number: "E-003",
      name: "Carl Reyes",
      manager_number: "E-002",
      department: null,
      cost_centre: null,
      depth: 3,
      reports: 0,
    },
    {
      number: "E-004",
      name: "Diva Reyes",
      manager_number: "E-002",
      department: "Sales",
      cost_centre: "CC-2",
      depth: 3,
      reports: 0,
    },
  ],
  unplaced: [{ number: "E-005", name: "Eli Reyes" }],
};

void test("a depth is an indent, and the chart keeps the order the backend stated", () => {
  const rows = chartRows(CHART);
  assert.deepEqual(
    rows.map((row) => row.number),
    ["E-001", "E-002", "E-003", "E-004"],
  );
  assert.deepEqual(
    rows.map((row) => row.indent),
    [0, 1, 2, 2],
  );
  assert.deepEqual(
    rows.map((row) => row.reports),
    [1, 2, 0, 0],
  );
  assert.deepEqual(rows[0].managerNumber, { kind: "unset" }, "the root has no manager");
});

void test("absent, null and a value are three different facts", () => {
  const [root, hidden, unrecorded] = chartRows(CHART);
  assert.deepEqual(root.name, { kind: "value", value: "Ana Reyes" });
  assert.deepEqual(root.department, { kind: "value", value: "Executive" });
  // No keys: a restriction removed them, which is not the same as an empty field.
  assert.deepEqual(hidden.name, { kind: "withheld" });
  assert.deepEqual(hidden.department, { kind: "withheld" });
  // Present and null: nobody recorded it.
  assert.deepEqual(unrecorded.department, { kind: "unset" });
  assert.deepEqual(unrecorded.costCentre, { kind: "unset" });
  // An empty string is not a department either — it is an unset one.
  assert.deepEqual(textState({ department: "  " }, "department"), { kind: "unset" });
});

void test("what is printed when a field is missing says which kind of missing it is", () => {
  const [root, hidden, unrecorded] = chartRows(CHART);
  assert.equal(fieldLabel(root.department, "not permitted", "not recorded"), "Executive");
  assert.equal(fieldLabel(hidden.department, "not permitted", "not recorded"), "not permitted");
  assert.equal(
    fieldLabel(unrecorded.department, "not permitted", "not recorded"),
    "not recorded",
  );
});

void test("the totals keep a withheld department, an unrecorded one and an unplaced person apart", () => {
  const summary = chartSummary(CHART);
  assert.equal(summary.placed, 4);
  assert.equal(summary.unplaced, 1);
  assert.deepEqual(summary.departments, [
    { department: "Executive", headcount: 1 },
    { department: "Sales", headcount: 1 },
  ]);
  assert.equal(summary.departmentWithheld, 1, "the hidden department is not an empty one");
  assert.equal(summary.departmentUnrecorded, 1);
  assert.equal(summary.deepest, 3);
  // Nobody unplaced is counted into a department, and the headcounts add up to the people
  // the chart draws — never to everybody on the payroll.
  assert.equal(
    summary.departments.reduce((total, group) => total + group.headcount, 0) +
      summary.departmentWithheld +
      summary.departmentUnrecorded,
    summary.placed,
  );
});

void test("the unplaced are listed by number and never drawn as roots", () => {
  const rows = unplacedRows(CHART);
  assert.deepEqual(rows.map((row) => row.number), ["E-005"]);
  assert.deepEqual(rows[0].name, { kind: "value", value: "Eli Reyes" });
  assert.ok(
    chartRows(CHART).every((row) => row.number !== "E-005"),
    "somebody the tree could not draw was drawn in it",
  );
});

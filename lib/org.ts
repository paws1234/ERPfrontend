/**
 * T-5.EMP.02 — the org chart, computed from the API payload.
 *
 * The hierarchy arrives ready to draw: the backend sends one line per person in chart
 * order, each carrying its depth and how many people report to it directly, because the
 * structure is the backend's to decide (it refuses the cycles and the second root that
 * would break it). What is left for this repository is presentation logic worth stating
 * once and testing rather than repeating in a component: the **indent** a depth means,
 * and the **three states** a field can be in.
 *
 * **A field has three states, not two** — the same rule `nameState` keeps for a pipeline
 * card (T-3.SALES.02): *withheld* (the key is absent because a field restriction removed
 * it), *unset* (present but null — nobody recorded it) and a *value*. The endpoint filters
 * the payload the same way, so collapsing them here would tell a viewer their role hid a
 * department that was simply never entered.
 *
 * **An unplaced person is not a department.** Somebody the tree cannot draw is counted
 * apart from the people who are in it with no department recorded, and apart again from
 * those whose department is withheld: three different facts about three different people.
 */

import type { components } from "./contract";
import type { FieldState } from "./pipeline";

// The three states a field can be in are stated once, for the board (T-3.SALES.02) and the
// chart alike; this module re-exports the type so a reader of the chart does not have to
// reach into the board's module for it.
export type { FieldState };

export type OrgChart = components["schemas"]["OrgChartOut"];
export type OrgEntry = components["schemas"]["OrgChartEntryOut"];
export type OrgUnplaced = components["schemas"]["OrgChartUnplacedOut"];

/** One line of the chart: what to print, how far to indent it, and what it says. */
export interface OrgRow {
  number: string;
  /** 1 for the root, 2 for those reporting to it. The payload states it. */
  depth: number;
  /** How far the line is indented — what `depth` means to a reader. */
  indent: number;
  /** How many people report to this one directly. */
  reports: number;
  managerNumber: FieldState<string>;
  name: FieldState<string>;
  department: FieldState<string>;
  costCentre: FieldState<string>;
}

export interface DepartmentGroup {
  department: string;
  headcount: number;
}

export interface ChartSummary {
  /** People the tree draws. */
  placed: number;
  /** People the tree cannot draw — never placed, or their manager is no longer an employee. */
  unplaced: number;
  /** Departments with somebody in them, by name, with their headcount. */
  departments: DepartmentGroup[];
  /** Placed people whose department a field restriction **hid** — not one nobody recorded. */
  departmentWithheld: number;
  /** Placed people with no department recorded. */
  departmentUnrecorded: number;
  /** The deepest line in the chart, 0 when nobody is placed. */
  deepest: number;
}

/** A field as one of the three states, from the row it belongs to. */
export function textState(row: Record<string, unknown>, key: string): FieldState<string> {
  if (!(key in row) || row[key] === undefined) {
    return { kind: "withheld" };
  }
  if (row[key] === null) {
    return { kind: "unset" };
  }
  const text = String(row[key]).trim();
  return text === "" ? { kind: "unset" } : { kind: "value", value: text };
}

/** The chart as the lines a reader sees, in the order the backend stated. */
export function chartRows(chart: OrgChart): OrgRow[] {
  return chart.entries.map((entry) => ({
    number: entry.number,
    depth: entry.depth,
    indent: Math.max(0, entry.depth - 1),
    reports: entry.reports,
    managerNumber: textState(entry, "manager_number"),
    name: textState(entry, "name"),
    department: textState(entry, "department"),
    costCentre: textState(entry, "cost_centre"),
  }));
}

/** The people the tree cannot draw, in the order the backend stated. */
export function unplacedRows(chart: OrgChart): { number: string; name: FieldState<string> }[] {
  return chart.unplaced.map((row) => ({ number: row.number, name: textState(row, "name") }));
}

/**
 * The chart's totals, keeping the three facts about a department apart.
 *
 * A department that is **withheld** is not one nobody recorded, and neither is a reason
 * to leave somebody out of `placed`: the totals count people, and the two counters state
 * what is missing about them.
 */
export function chartSummary(chart: OrgChart): ChartSummary {
  const rows = chartRows(chart);
  const departments = new Map<string, number>();
  let departmentWithheld = 0;
  let departmentUnrecorded = 0;

  for (const row of rows) {
    if (row.department.kind === "value") {
      departments.set(row.department.value, (departments.get(row.department.value) ?? 0) + 1);
    } else if (row.department.kind === "withheld") {
      departmentWithheld += 1;
    } else {
      departmentUnrecorded += 1;
    }
  }

  return {
    placed: rows.length,
    unplaced: chart.unplaced.length,
    departments: [...departments.entries()]
      .map(([department, headcount]) => ({ department, headcount }))
      .sort((left, right) => left.department.localeCompare(right.department)),
    departmentWithheld,
    departmentUnrecorded,
    deepest: rows.reduce((deepest, row) => Math.max(deepest, row.depth), 0),
  };
}

/** What to print for a field, or the reason there is nothing to print. */
export function fieldLabel(state: FieldState<string>, absent: string, unset: string): string {
  if (state.kind === "value") {
    return state.value;
  }
  return state.kind === "withheld" ? absent : unset;
}

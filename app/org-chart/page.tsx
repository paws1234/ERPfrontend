/**
 * T-5.EMP.02 — the org chart.
 *
 * Rendered on the server from the API payload, like every other screen: this process
 * talks to the API and never to the database. Two things the screen deliberately does
 * **not** do:
 *
 * * it does not derive the tree itself — the backend sends each line with its depth and
 *   its direct-report count, because the structure (one root, no cycles) is the backend's
 *   to decide, and a screen that re-derived it could disagree with the record;
 * * it does not print a missing field as blank — a field a restriction **hid** and a field
 *   nobody **recorded** are said differently (`lib/org`), so nobody reads a withheld
 *   department as an empty one.
 *
 * The date comes from the query string. With none stated, the screen asks about today and
 * says so: a chart is only meaningful "as of" something, and the API refuses to assume.
 */

import { describeFailure, instanceIdentity, readOrgChart } from "@/lib/api";
import {
  chartRows,
  chartSummary,
  fieldLabel,
  unplacedRows,
  type FieldState,
  type OrgChart,
} from "@/lib/org";

// The chart is live data: rendered per request, never cached at build.
export const dynamic = "force-dynamic";

/** Today, as the date the API takes — the default only, and it is printed on the page. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Label({
  state,
  absent,
  unset,
}: {
  state: FieldState<string>;
  absent: string;
  unset: string;
}) {
  const text = fieldLabel(state, absent, unset);
  return state.kind === "value" ? (
    <span>{text}</span>
  ) : (
    <span style={{ color: "#8a929c", fontStyle: "italic" }}>{text}</span>
  );
}

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string | string[] }>;
}) {
  const params = await searchParams;
  const stated = Array.isArray(params.on) ? params.on[0] : params.on;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(stated ?? "") ? (stated as string) : today();

  let chart: OrgChart | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    chart = await readOrgChart(instanceIdentity(), asOf);
  } catch (error) {
    // 401 asks for a session, 403 explains itself, anything else says what it was.
    failure = describeFailure(error);
  }

  const summary = chart ? chartSummary(chart) : null;
  const rows = chart ? chartRows(chart) : [];
  const unplaced = chart ? unplacedRows(chart) : [];

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Organisation</h1>
      <p style={{ color: "#5b6470" }}>
        {summary
          ? `as of ${chart?.as_of} · ${summary.placed} placed · ${summary.unplaced} not in the tree · deepest level ${summary.deepest}`
          : "The organisation chart could not be read."}
      </p>

      <form method="get" style={{ margin: "0.5rem 0 1rem" }}>
        <label htmlFor="on" style={{ marginRight: "0.5rem" }}>
          As of
        </label>
        <input type="date" id="on" name="on" defaultValue={asOf} />
        <button type="submit" style={{ marginLeft: "0.5rem" }}>
          Show
        </button>
      </form>

      {failure ? (
        <div
          style={{
            border: "1px solid #d9a300",
            background: "#fff8e6",
            padding: "1rem",
            borderRadius: 6,
          }}
        >
          <strong>{failure.title}</strong>
          <p style={{ margin: "0.25rem 0 0" }}>{failure.detail}</p>
        </div>
      ) : null}

      {summary && summary.placed === 0 ? (
        <p style={{ color: "#5b6470" }}>
          Nobody has been placed in the structure on this date. The people below have no
          reporting line recorded yet.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
          {rows.map((row) => (
            <li
              key={row.number}
              style={{
                marginLeft: `${row.indent * 1.5}rem`,
                padding: "0.35rem 0 0.35rem 0.75rem",
                borderLeft: row.indent === 0 ? "3px solid #16181d" : "2px solid #d7dbe0",
              }}
            >
              <strong>{row.number}</strong>{" "}
              <Label state={row.name} absent="name withheld" unset="name not recorded" />
              <br />
              <span style={{ color: "#5b6470", fontSize: "0.9rem" }}>
                <Label
                  state={row.department}
                  absent="department withheld"
                  unset="no department recorded"
                />
                {" · "}
                <Label
                  state={row.costCentre}
                  absent="cost centre withheld"
                  unset="no cost centre recorded"
                />
                {" · "}
                {row.reports === 0
                  ? "no direct reports"
                  : `${row.reports} direct report${row.reports === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {summary ? (
        <p style={{ color: "#5b6470", fontSize: "0.9rem" }}>
          {summary.departments.length === 0
            ? "No department has anybody in it on this date."
            : summary.departments
                .map((group) => `${group.department} (${group.headcount})`)
                .join(" · ")}
          {summary.departmentWithheld > 0
            ? ` · ${summary.departmentWithheld} whose department your role may not read`
            : ""}
          {summary.departmentUnrecorded > 0
            ? ` · ${summary.departmentUnrecorded} with no department recorded`
            : ""}
        </p>
      ) : null}

      {unplaced.length > 0 ? (
        <div style={{ borderTop: "1px solid #e3e6ea", paddingTop: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Not in the tree</h2>
          <p style={{ color: "#5b6470", margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
            {unplaced.length} {unplaced.length === 1 ? "person has" : "people have"} no
            reporting line this chart can draw — nobody has placed them, or the manager they
            were placed under is no longer an employee. They are absent from the structure
            above rather than drawn at its top, which belongs to one employee only.
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {unplaced.map((row) => (
              <li key={row.number}>
                <strong>{row.number}</strong>{" "}
                <Label state={row.name} absent="name withheld" unset="name not recorded" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

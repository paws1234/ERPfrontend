/**
 * T-6.ANALYTICS.01 — the dashboards: finance and operations, and the records behind them.
 *
 * Rendered on the server from one API call, and rendered **per request**: the figures are the
 * ledger as it stands and the page states the instant they were taken, so there is no overnight
 * snapshot to be stale. Each figure carries the reconciliation it must agree with, and each
 * opens onto the rows it was summed from one step away (`?drill_down=…`), which is the same
 * request answering with the rows that produced the number rather than a second query.
 *
 * A tile this actor may not see is not rendered as zero: the capability that guards it is named
 * and it is listed as withheld. The API refuses it either way — hiding a tile here is a courtesy,
 * not the control.
 */

import Link from "next/link";

import { describeFailure, instanceIdentity, readDashboard } from "@/lib/api";
import { dashboardView, readAt, type DashboardView, type TileView } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const IDENTITY = instanceIdentity();

function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        border: "1px solid #f0c2c2",
        background: "#fff6f6",
        padding: "0.75rem 1rem",
        borderRadius: 6,
        marginBottom: "1rem",
      }}
    >
      <strong>{title}</strong>
      <p style={{ margin: "0.25rem 0 0", color: "#5b6470" }}>{detail}</p>
    </div>
  );
}

function Tile({ tile }: { tile: TileView }) {
  const colour =
    tile.reconciliation.state === "balanced"
      ? "#0f766e"
      : tile.reconciliation.state === "difference"
        ? "#b45309"
        : "#b91c1c";
  return (
    <section
      style={{
        border: "1px solid #dfe3e8",
        borderRadius: 6,
        padding: "0.75rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.05rem" }}>{tile.label}</h2>
      <table style={{ borderCollapse: "collapse", marginBottom: "0.5rem" }}>
        <tbody>
          {tile.figures.map((figure) => (
            <tr key={figure.label}>
              <td style={{ padding: "0.15rem 1rem 0.15rem 0", color: "#5b6470" }}>
                {figure.label}
              </td>
              <td style={{ padding: "0.15rem 0", fontVariantNumeric: "tabular-nums" }}>
                {figure.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "0 0 0.25rem", color: colour }}>{tile.reconciliation.sentence}</p>
      <p style={{ margin: 0, color: "#5b6470", fontSize: "0.9rem" }}>
        <Link href={tile.drillDown} style={{ color: "#1d4ed8" }}>
          Open the records behind it
        </Link>{" "}
        · guarded by <code>{tile.capability}</code>
      </p>
    </section>
  );
}

function Opened({ view }: { view: DashboardView }) {
  const tile = view.opened;
  if (tile === null) return null;
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.05rem", marginBottom: "0.25rem" }}>
        {tile.label} — {tile.rowCount} row(s) behind the figure
      </h2>
      <p style={{ color: "#5b6470", marginTop: 0 }}>
        {tile.truncated
          ? `Showing the first ${tile.rows.length} of ${tile.rowCount}: the figure is the whole arithmetic, the list is bounded.`
          : "Every row the figure was computed from, from the same read."}
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {tile.rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} style={{ borderTop: "1px solid #eef1f4" }}>
              <td style={{ padding: "0.25rem 1rem 0.25rem 0", whiteSpace: "nowrap" }}>
                {row.label}
              </td>
              <td style={{ padding: "0.25rem 0", color: "#5b6470" }}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: "0.75rem" }}>
        <Link href="/dashboard" style={{ color: "#1d4ed8" }}>
          Back to the dashboard
        </Link>
      </p>
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ drill_down?: string; as_of?: string; start?: string }>;
}) {
  const { drill_down: drillDown, as_of: asOf, start } = await searchParams;
  let view: DashboardView | null = null;
  let failure: { title: string; detail: string } | null = null;
  try {
    view = dashboardView(
      await readDashboard(IDENTITY, { asOf, start, drillDown }),
      drillDown,
    );
  } catch (error) {
    failure = describeFailure(error);
  }

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Dashboards</h1>
      <p style={{ color: "#5b6470" }}>
        {view
          ? `${view.start} to ${view.asOf} · read at ${readAt(view.readAt)} · refreshed by reloading, never from a snapshot`
          : "No company bound to this instance yet."}
      </p>

      {failure ? <Notice title={failure.title} detail={failure.detail} /> : null}

      {view?.tiles.map((tile) => (
        <Tile key={tile.code} tile={tile} />
      ))}

      {view && view.withheld.length > 0 ? (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Withheld from this actor</h2>
          <ul style={{ color: "#5b6470" }}>
            {view.withheld.map((tile) => (
              <li key={tile.code}>
                <strong>{tile.label}</strong> — {tile.reason} (needs <code>{tile.capability}</code>
                )
              </li>
            ))}
          </ul>
          <p style={{ color: "#5b6470", fontSize: "0.9rem" }}>
            These are absent rather than zero: the API refuses them per tile, and every refusal is
            on the trail.
          </p>
        </section>
      ) : null}

      {view ? <Opened view={view} /> : null}
    </section>
  );
}

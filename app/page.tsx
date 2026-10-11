/**
 * T-0.API.02 — the shell's first screen: the company it is speaking for and one
 * page of the ledger, read through the generated client.
 *
 * Rendering happens on the server: this process talks to the API and never to
 * the database, which is the delivery rule DOMAIN-MODELS.md and the ledger's
 * `## Repositories` map both state (API-first, one container per service).
 */

import {
  companyProfile,
  health,
  listJournalEntries,
  type JournalPage,
} from "@/lib/api";
import { sessionCookie, sessionFailure } from "@/lib/session";

// A ledger is live data: this page is rendered per request, never cached at build.
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  // Who is asking is the request's own session (T-7.AUTH.02): there is no instance identity to
  // fall back on, and a request without one is a request the API answers 401.
  const session = await sessionCookie();
  const version = await health(session).catch(() => null);
  let profile: Awaited<ReturnType<typeof companyProfile>> | null = null;
  let page: JournalPage | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    profile = await companyProfile(session);
    page = await listJournalEntries(session, { limit: 10 });
  } catch (error) {
    // A refusal is a state the shell renders, not a crash: a session that is gone sends the
    // browser to the sign-in screen, 403 explains itself, anything else says what it was.
    failure = sessionFailure(error);
  }

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>{profile ? profile.name : "Ledger"}</h1>
      <p style={{ color: "#5b6470" }}>
        {profile
          ? `Company ${profile.code} · base currency ${profile.base_currency} · fiscal year starts in month ${profile.fiscal_year_start_month}`
          : "No company bound to this instance yet."}
        {version ? ` · API ${version.version}` : ""}
      </p>

      <p style={{ color: "#5b6470" }}>
        <a href="/pos" style={{ color: "#1d4ed8" }}>
          Point of sale
        </a>
      </p>

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

      {page ? (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
          <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>
            {page.total} journal {page.total === 1 ? "entry" : "entries"}, showing {page.items.length}
          </caption>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Posted</th>
              <th style={{ textAlign: "left" }}>Account</th>
              <th style={{ textAlign: "right" }}>Debit</th>
              <th style={{ textAlign: "right" }}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {page.items.flatMap((entry) =>
              entry.lines.map((line) => (
                <tr key={`${entry.id}-${line.line_no}`} style={{ borderTop: "1px solid #e6e8eb" }}>
                  <td>{entry.posting_date}</td>
                  <td>{line.account}</td>
                  <td style={{ textAlign: "right" }}>{line.debit}</td>
                  <td style={{ textAlign: "right" }}>{line.credit}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

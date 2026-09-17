/**
 * T-0.API.02 — the shell's first screen: the company it is speaking for and one
 * page of the ledger, read through the generated client.
 *
 * Rendering happens on the server: this process talks to the API and never to
 * the database, which is the delivery rule DOMAIN-MODELS.md and the ledger's
 * `## Repositories` map both state (API-first, one container per service).
 */

import {
  describeFailure,
  listJournalEntries,
  companyProfile,
  health,
  type Identity,
  type JournalPage,
} from "@/lib/api";

// The instance's own identity, from the environment at start — no rebuild.
const IDENTITY: Identity = {
  companyId: process.env.COMPANY_ID ?? "00000000-0000-0000-0000-000000000000",
  actor: process.env.ACTOR ?? "shell",
};

// A ledger is live data: this page is rendered per request, never cached at build.
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const version = await health().catch(() => null);
  let profile: Awaited<ReturnType<typeof companyProfile>> | null = null;
  let page: JournalPage | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    profile = await companyProfile(IDENTITY);
    page = await listJournalEntries(IDENTITY, { limit: 10 });
  } catch (error) {
    // A refusal is a state the shell renders, not a crash: 401 asks for a
    // session, 403 explains itself, anything else says what it was.
    failure = describeFailure(error);
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
              <th style={{ textAlign: "left" }}>Memo</th>
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
                  <td>{entry.memo ?? ""}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

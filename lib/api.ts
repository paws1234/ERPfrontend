/**
 * T-0.API.02 — the typed client, generated from the published contract.
 *
 * Every call goes through `request()`, and every shape it speaks comes from
 * `./contract`, which is generated from the backend repository's published
 * contract artifact (`npm run contract:pull`). The repository holds no database
 * driver, no connection string and no backend source: the contract is the only
 * coupling, so a field the backend stops sending fails this build instead of
 * failing in front of a customer.
 *
 * Identity is the **session cookie** and nothing else. The backend mints `erpv1_session`
 * at `POST /api/v1/auth/login` and resolves the caller, the company they are acting in and
 * their capabilities from the session row behind it, so this file states no actor of its
 * own: `./session` reads the incoming request's cookie with `next/headers` and hands it
 * here, and it travels as the `Cookie` header. The per-request `X-Company-Id`/`X-Actor`
 * headers this client used to assert from `COMPANY_ID`/`ACTOR` are gone — an identity a
 * caller states about itself is an identity anyone can claim (T-7.AUTH.02 replaced
 * T-0.API.01, and only this file changed when it did).
 *
 * The refusals the shell must survive are distinct types:
 *  - `Unauthenticated` (401) — there is no session, or it expired or was revoked: the
 *    sign-in screen, with the reason;
 *  - `MfaRequired` (401, code `mfa_required`) — there *is* a session and it still owes a
 *    second factor, which every route but `auth/mfa/verify` refuses until it is answered:
 *    the second-factor prompt;
 *  - `NotPermitted` (403) — a capability the caller lacks: the shell says so and keeps
 *    working.
 */

import type { components, paths } from "./contract";

export type JournalEntry = components["schemas"]["JournalEntryOut"];
export type JournalLine = components["schemas"]["JournalLineOut"];
export type JournalPage = components["schemas"]["PageOut"];
export type CompanyProfile = components["schemas"]["CompanyOut"];
export type Health = components["schemas"]["HealthOut"];
export type ApiErrorBody = components["schemas"]["ErrorOut"];
/** T-2.PROC.04: one RFQ with what every invited supplier answered. */
export type Rfq = components["schemas"]["RfqOut"];
/** T-3.SALES.02: the opportunity board's columns and the cards standing in them. */
export type PipelineColumn = components["schemas"]["PipelineColumnOut"];
/** T-3.SALES.02: one card after a mutation — the fields this caller may read, the
 * stage it now stands in, and the move that put it there. */
export type Opportunity = components["schemas"]["OpportunityOut"];
/** T-3.SALES.02: the document a won opportunity produced. */
export type Quotation = components["schemas"]["QuotationOut"];
/** T-5.EMP.02: the reporting hierarchy on one date, and who it cannot place. */
export type OrgChart = components["schemas"]["OrgChartOut"];
/** T-6.ANALYTICS.01: the dashboard's tiles, and what each of them reconciles to. */
export type Dashboard = components["schemas"]["DashboardOut"];
export type DashboardTile = components["schemas"]["DashboardTileOut"];
export type DashboardWithheld = components["schemas"]["DashboardWithheldOut"];
/** T-7.AUTH.02: who the caller is, the company they are acting in, and what they may see. */
export type Session = components["schemas"]["SessionOut"];
/** The one error shape every refusal states. */
export type ApiRefusal = components["schemas"]["ErrorOut"]["error"];

/** The paths this client speaks, read straight out of the contract. */
export type LedgerListPath = paths["/api/v1/journal-entries"]["get"];
export type CompanyPath = paths["/api/v1/companies/current"]["get"];

/** The backend's base URL, injected at container start — never baked in. */
export const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";

/**
 * Who is calling: the `Cookie` header built from the incoming request's session cookie, or
 * `""` for a request that carries none — which the backend answers with 401 like any other
 * cookie it does not recognise. `./session` is the only module that reads it.
 */
export type SessionCookie = string;

export class Unauthenticated extends Error {
  constructor(message = "sign in to continue") {
    super(message);
    this.name = "Unauthenticated";
  }
}

/**
 * The session exists and still owes a second factor. Distinct from `Unauthenticated`
 * because the answer is not a sign-in form but a code: the cookie is good, the session is
 * simply not complete yet.
 */
export class MfaRequired extends Error {
  constructor(message = "this session still owes a second factor") {
    super(message);
    this.name = "MfaRequired";
  }
}

export class NotPermitted extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "NotPermitted";
    this.code = code;
  }
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
  }
}

/** The error body a refusal states, when it states one at all. */
async function errorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

/**
 * Turn a refusal into the type the shell branches on. The two 401s are told apart by the
 * code the backend states, so "sign in again" and "answer the second factor" are never
 * mistaken for one another, and the message shown is the backend's own wording.
 */
export async function refusal(response: Response): Promise<Error> {
  const detail = (await errorBody(response))?.error;
  if (response.status === 401 && detail?.code === "mfa_required") {
    return new MfaRequired(detail.message);
  }
  if (response.status === 401) {
    return new Unauthenticated(detail?.message);
  }
  if (response.status === 403) {
    return new NotPermitted(detail?.message ?? "not permitted", detail?.code ?? "forbidden");
  }
  return new ApiFailure(
    response.status,
    detail?.code ?? "unknown",
    detail?.message ?? response.statusText,
  );
}

/** One request, with the statuses the shell branches on separated out. */
export async function request<T>(
  path: string,
  session: SessionCookie,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session === "" ? {} : { Cookie: session }),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw await refusal(response);
  }
  return (await response.json()) as T;
}

/** The platform's own health. Public, and read with whatever session there is. */
export function health(session: SessionCookie = ""): Promise<Health> {
  return request<Health>("/api/v1/health", session);
}

export function companyProfile(session: SessionCookie): Promise<CompanyProfile> {
  return request<CompanyPath["responses"][200]["content"]["application/json"]>(
    "/api/v1/companies/current",
    session,
  );
}

export function listJournalEntries(
  session: SessionCookie,
  { limit = 25, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<JournalPage> {
  return request<JournalPage>(
    `/api/v1/journal-entries?limit=${limit}&offset=${offset}`,
    session,
  );
}

/**
 * T-2.PROC.04 — one RFQ as the API states it: its lines, who was asked and what
 * each of them answered, with the basis the comparison has to be made on.
 *
 * Read-only, and the only place the matrix gets its data: the comparison itself
 * (./comparison) computes over this payload and never over a database.
 */
export function readRfq(session: SessionCookie, number: string): Promise<Rfq> {
  return request<Rfq>(`/api/v1/rfqs/${encodeURIComponent(number)}`, session);
}

/**
 * T-3.SALES.02 — the opportunity board, as the API states it.
 *
 * Read-only. The columns are the company's own configuration and the cards are
 * filtered per field permission before they leave the backend, so a field this
 * actor may not read is **absent** from a card rather than null — `lib/pipeline`
 * is what turns that distinction into the numbers the board shows.
 */
export function readPipelineBoard(session: SessionCookie): Promise<PipelineColumn[]> {
  return request<PipelineColumn[]>("/api/v1/pipeline/board", session);
}

/**
 * T-5.EMP.02 — the reporting hierarchy on a date, as the API states it.
 *
 * Read-only, and **dated by the request**: the date is passed rather than assumed, so the
 * same call draws today's structure and any past one, and a screen that shows "as of" is
 * showing what it actually asked for. The payload is already in chart order with each
 * line's depth, because the structure is the backend's to decide; `lib/org` turns that
 * into indents, labels and totals.
 */
export function readOrgChart(session: SessionCookie, on: string): Promise<OrgChart> {
  return request<OrgChart>(`/api/v1/org-chart?on=${encodeURIComponent(on)}`, session);
}

/**
 * The four writes that make the board drivable rather than a picture.
 *
 * Every one of them goes through `request()` like the reads, so a 401, a 403 and a
 * domain refusal arrive as the same types the shell already branches on. The actor is
 * never something the caller types: the session names it, the backend records it on the
 * move, and the instant is the server's.
 *
 * `undefined` fields are dropped by `JSON.stringify`, so a caller that states no
 * value does not send one — which matters, because the backend treats a field the
 * caller actually set as a write (T-0.SEC.01).
 */
export interface NewOpportunity {
  customerCode: string;
  name: string;
  owner: string;
  /** A decimal string at the platform's money scale, or nothing at all. */
  value?: string;
  /** An ISO date (`YYYY-MM-DD`). */
  expectedClose?: string;
  /** The column to open the card in; the first stage when unstated. */
  stage?: string;
}

export function createOpportunity(
  session: SessionCookie,
  deal: NewOpportunity,
): Promise<Opportunity> {
  return request<Opportunity>("/api/v1/opportunities", session, {
    method: "POST",
    body: JSON.stringify({
      customer_code: deal.customerCode,
      name: deal.name,
      owner: deal.owner,
      value: deal.value,
      expected_close: deal.expectedClose,
      stage: deal.stage,
    }),
  });
}

/** Move a card to a column. Moving into a loss column needs a reason. */
export function moveOpportunity(
  session: SessionCookie,
  opportunityId: string,
  toStage: string,
  reason?: string,
): Promise<Opportunity> {
  return request<Opportunity>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/moves`,
    session,
    { method: "POST", body: JSON.stringify({ to_stage: toStage, reason }) },
  );
}

/** Mark a deal lost, with the reason the domain requires. */
export function loseOpportunity(
  session: SessionCookie,
  opportunityId: string,
  reason: string,
): Promise<Opportunity> {
  return request<Opportunity>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/loss`,
    session,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/** Turn a won deal into a quotation. One win, one quotation. */
export function convertOpportunity(
  session: SessionCookie,
  opportunityId: string,
  number: string,
  issuedOn?: string,
): Promise<Quotation> {
  return request<Quotation>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/quotation`,
    session,
    { method: "POST", body: JSON.stringify({ number, issued_on: issuedOn }) },
  );
}

/**
 * T-6.ANALYTICS.01 — the dashboard, as the API states it.
 *
 * Read-only, and **always** read fresh: the request asks for the ledger as it stands, so a
 * refresh is a reload rather than a wait for a job. `drillDown` asks one tile for the rows its
 * figure was computed from — the same run, not a second query — which is what makes a figure
 * here openable in one step. A tile the caller may not see is simply not in `tiles`; it is
 * named in `withheld` instead, and the page shows that rather than a zero.
 */
export function readDashboard(
  session: SessionCookie,
  {
    asOf,
    start,
    drillDown,
  }: { asOf?: string; start?: string; drillDown?: string } = {},
): Promise<Dashboard> {
  const query = new URLSearchParams();
  if (asOf) query.set("as_of", asOf);
  if (start) query.set("start", start);
  if (drillDown) query.set("drill_down", drillDown);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request<Dashboard>(`/api/v1/dashboard${suffix}`, session);
}

/**
 * What a page does with a failure: the sign-in prompt for 401, the second-factor prompt
 * for a session that still owes one, a notice for 403, and a plain message for anything
 * else. The shell never throws its way to a blank page.
 */
export function describeFailure(error: unknown): { title: string; detail: string } {
  if (error instanceof Unauthenticated) {
    return { title: "Sign in required", detail: error.message };
  }
  if (error instanceof MfaRequired) {
    return { title: "Second factor required", detail: error.message };
  }
  if (error instanceof NotPermitted) {
    return { title: "Not permitted", detail: error.message };
  }
  if (error instanceof ApiFailure || error instanceof Error) {
    return { title: "Something went wrong", detail: error.message };
  }
  return { title: "Something went wrong", detail: String(error) };
}

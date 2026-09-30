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
 * The two refusals the shell must survive are distinct types:
 *  - `Unauthenticated` (401) — the shell shows the session flow;
 *  - `NotPermitted` (403) — the shell says so and keeps working.
 *
 * Identity is stated per request (`X-Company-Id`, `X-Actor`) because the backend
 * boundary reads it from headers today (T-0.API.01); T-0.SEC.01 replaces that
 * with authenticated claims, and only this file changes when it does.
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

/** The paths this client speaks, read straight out of the contract. */
export type LedgerListPath = paths["/api/v1/journal-entries"]["get"];
export type CompanyPath = paths["/api/v1/companies/current"]["get"];

/** The backend's base URL, injected at container start — never baked in. */
export const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";

/** Which company and actor this instance speaks for. */
export interface Identity {
  companyId: string;
  actor: string;
}

export class Unauthenticated extends Error {
  constructor(message = "sign in to continue") {
    super(message);
    this.name = "Unauthenticated";
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

/** One request, with the statuses the shell branches on separated out. */
export async function request<T>(
  path: string,
  identity: Identity,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Company-Id": identity.companyId,
      "X-Actor": identity.actor,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Unauthenticated();
  }
  if (response.status === 403) {
    const body = (await response.json()) as ApiErrorBody;
    throw new NotPermitted(body.error.message, body.error.code);
  }
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    throw new ApiFailure(response.status, body.error.code, body.error.message);
  }
  return (await response.json()) as T;
}

export function health(): Promise<Health> {
  return request<Health>("/api/v1/health", { companyId: "", actor: "" });
}

/**
 * The instance's own identity, read from the environment at start — no rebuild.
 * One place, so every screen speaks as the same company and actor.
 */
export function instanceIdentity(): Identity {
  return {
    companyId: process.env.COMPANY_ID ?? "00000000-0000-0000-0000-000000000000",
    actor: process.env.ACTOR ?? "shell",
  };
}

export function companyProfile(identity: Identity): Promise<CompanyProfile> {
  return request<CompanyPath["responses"][200]["content"]["application/json"]>(
    "/api/v1/companies/current",
    identity,
  );
}

export function listJournalEntries(
  identity: Identity,
  { limit = 25, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<JournalPage> {
  return request<JournalPage>(
    `/api/v1/journal-entries?limit=${limit}&offset=${offset}`,
    identity,
  );
}

/**
 * T-2.PROC.04 — one RFQ as the API states it: its lines, who was asked and what
 * each of them answered, with the basis the comparison has to be made on.
 *
 * Read-only, and the only place the matrix gets its data: the comparison itself
 * (./comparison) computes over this payload and never over a database.
 */
export function readRfq(identity: Identity, number: string): Promise<Rfq> {
  return request<Rfq>(`/api/v1/rfqs/${encodeURIComponent(number)}`, identity);
}

/**
 * T-3.SALES.02 — the opportunity board, as the API states it.
 *
 * Read-only. The columns are the company's own configuration and the cards are
 * filtered per field permission before they leave the backend, so a field this
 * actor may not read is **absent** from a card rather than null — `lib/pipeline`
 * is what turns that distinction into the numbers the board shows.
 */
export function readPipelineBoard(identity: Identity): Promise<PipelineColumn[]> {
  return request<PipelineColumn[]>("/api/v1/pipeline/board", identity);
}

/**
 * The four writes that make the board drivable rather than a picture.
 *
 * Every one of them goes through `request()` like the reads, so a 401, a 403 and a
 * domain refusal arrive as the same three types the shell already branches on. The
 * actor is the **instance's** identity, never something the caller types: the actor a
 * move records has to be the request's own, and the instant is the server's.
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
  identity: Identity,
  deal: NewOpportunity,
): Promise<Opportunity> {
  return request<Opportunity>("/api/v1/opportunities", identity, {
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
  identity: Identity,
  opportunityId: string,
  toStage: string,
  reason?: string,
): Promise<Opportunity> {
  return request<Opportunity>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/moves`,
    identity,
    { method: "POST", body: JSON.stringify({ to_stage: toStage, reason }) },
  );
}

/** Mark a deal lost, with the reason the domain requires. */
export function loseOpportunity(
  identity: Identity,
  opportunityId: string,
  reason: string,
): Promise<Opportunity> {
  return request<Opportunity>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/loss`,
    identity,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/** Turn a won deal into a quotation. One win, one quotation. */
export function convertOpportunity(
  identity: Identity,
  opportunityId: string,
  number: string,
  issuedOn?: string,
): Promise<Quotation> {
  return request<Quotation>(
    `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/quotation`,
    identity,
    { method: "POST", body: JSON.stringify({ number, issued_on: issuedOn }) },
  );
}

/**
 * What a page does with a failure: the sign-in prompt for 401, a notice for 403,
 * and a plain message for anything else. The shell never throws its way to a
 * blank page.
 */
export function describeFailure(error: unknown): { title: string; detail: string } {
  if (error instanceof Unauthenticated) {
    return { title: "Sign in required", detail: error.message };
  }
  if (error instanceof NotPermitted) {
    return { title: "Not permitted", detail: error.message };
  }
  if (error instanceof ApiFailure || error instanceof Error) {
    return { title: "Something went wrong", detail: error.message };
  }
  return { title: "Something went wrong", detail: String(error) };
}

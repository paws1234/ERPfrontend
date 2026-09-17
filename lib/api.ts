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

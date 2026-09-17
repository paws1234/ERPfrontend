/**
 * T-0.API.02 — what the shell does with the two refusals and with a failure.
 *
 *   node --experimental-strip-types --test tests/*.test.ts
 *
 * It fails if a 401 stops being a distinct `Unauthenticated` (the session flow)
 * or a 403 stops being a `NotPermitted` the shell can explain and survive.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiFailure,
  NotPermitted,
  Unauthenticated,
  describeFailure,
  listJournalEntries,
  request,
} from "../lib/api.ts";

const IDENTITY = { companyId: "11111111-1111-1111-1111-111111111111", actor: "alice" };

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

test("a 401 is the session flow, not a crash", async () => {
  stubFetch(401, { error: { code: "unauthenticated", message: "sign in", details: null } });
  await assert.rejects(() => request("/api/v1/companies/current", IDENTITY), Unauthenticated);
  assert.deepEqual(describeFailure(new Unauthenticated()), {
    title: "Sign in required",
    detail: "sign in to continue",
  });
});

test("a 403 is explained and the shell keeps working", async () => {
  stubFetch(403, {
    error: { code: "forbidden", message: "'bob' may not 'journal.read' (no roles)", details: null },
  });
  await assert.rejects(
    () => request("/api/v1/journal-entries", IDENTITY),
    (error: unknown) => {
      assert.ok(error instanceof NotPermitted);
      assert.equal(error.code, "forbidden");
      return true;
    },
  );
  const described = describeFailure(new NotPermitted("'bob' may not 'journal.read'", "forbidden"));
  assert.equal(described.title, "Not permitted");
  assert.match(described.detail, /may not/);
});

test("any other failure says what it was", async () => {
  stubFetch(422, {
    error: { code: "unbalanced_entry", message: "entry does not balance", details: null },
  });
  await assert.rejects(
    () => request("/api/v1/journal-entries", IDENTITY),
    (error: unknown) => {
      assert.ok(error instanceof ApiFailure);
      assert.equal(error.status, 422);
      assert.equal(error.code, "unbalanced_entry");
      return true;
    },
  );
  assert.equal(describeFailure(new Error("boom")).title, "Something went wrong");
});

test("every call states which company it is for, and pages through the contract", async () => {
  const calls = stubFetch(200, { items: [], limit: 10, offset: 0, total: 0 });
  const page = await listJournalEntries(IDENTITY, { limit: 10 });
  assert.equal(page.total, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/journal-entries\?limit=10&offset=0$/);
  assert.equal(calls[0].headers["X-Company-Id"], IDENTITY.companyId);
  assert.equal(calls[0].headers["X-Actor"], IDENTITY.actor);
});

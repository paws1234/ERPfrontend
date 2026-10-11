/**
 * T-0.API.02 — what the shell does with the refusals and with a failure.
 *
 *   node --experimental-strip-types --test tests/*.test.ts
 *
 * It fails if a 401 stops being a distinct `Unauthenticated` (the session flow), if a 401 that
 * owes a second factor stops being its own `MfaRequired` (the prompt for a code), if a 403 stops
 * being a `NotPermitted` the shell can explain and survive — or if the identity a call carries
 * stops being the session cookie the server read on the caller's behalf (T-7.AUTH.02) and goes
 * back to being headers the caller states about itself.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiFailure,
  MfaRequired,
  NotPermitted,
  Unauthenticated,
  describeFailure,
  listJournalEntries,
  request,
} from "../lib/api.ts";

/** A session as the backend states it: the cookie is the whole of the identity. */
const SESSION = "erpv1_session=abc123";

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
  await assert.rejects(() => request("/api/v1/companies/current", SESSION), Unauthenticated);
  assert.deepEqual(describeFailure(new Unauthenticated()), {
    title: "Sign in required",
    detail: "sign in to continue",
  });
  assert.deepEqual(
    describeFailure(new Unauthenticated("sign in")),
    { title: "Sign in required", detail: "sign in" },
    "the backend's own wording is what the screen shows when it stated one",
  );
});

test("a 401 that owes a second factor is its own refusal, with its own prompt", async () => {
  stubFetch(401, {
    error: { code: "mfa_required", message: "answer the second factor", details: null },
  });
  await assert.rejects(
    () => request("/api/v1/companies/current", SESSION),
    (error: unknown) => {
      assert.ok(error instanceof MfaRequired);
      assert.ok(
        !(error instanceof Unauthenticated),
        "signing in again and answering a code are not the same answer",
      );
      assert.equal(error.message, "answer the second factor");
      return true;
    },
  );
  assert.deepEqual(describeFailure(new MfaRequired("answer the second factor")), {
    title: "Second factor required",
    detail: "answer the second factor",
  });
});

test("a 403 is explained and the shell keeps working", async () => {
  stubFetch(403, {
    error: { code: "forbidden", message: "'bob' may not 'journal.read' (no roles)", details: null },
  });
  await assert.rejects(
    () => request("/api/v1/journal-entries", SESSION),
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
    () => request("/api/v1/journal-entries", SESSION),
    (error: unknown) => {
      assert.ok(error instanceof ApiFailure);
      assert.equal(error.status, 422);
      assert.equal(error.code, "unbalanced_entry");
      return true;
    },
  );
  assert.equal(describeFailure(new Error("boom")).title, "Something went wrong");
});

test("every call carries the session cookie, and pages through the contract", async () => {
  const calls = stubFetch(200, { items: [], limit: 10, offset: 0, total: 0 });
  const page = await listJournalEntries(SESSION, { limit: 10 });
  assert.equal(page.total, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/journal-entries\?limit=10&offset=0$/);
  assert.equal(calls[0].headers["Cookie"], SESSION);
  assert.equal(calls[0].headers["X-Company-Id"], undefined, "no company is asserted by the caller");
  assert.equal(calls[0].headers["X-Actor"], undefined, "no actor is asserted by the caller");
});

test("a request with no session states no Cookie at all", async () => {
  const calls = stubFetch(200, { items: [], limit: 25, offset: 0, total: 0 });
  await listJournalEntries("");
  assert.equal(calls[0].headers["Cookie"], undefined);
});

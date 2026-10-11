// Scratch stub backend for a frontend smoke test. Deleted once the test is done.
import { createServer } from "node:http";

const mode = process.env.STUB_MODE ?? "deny";

function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}
const refuse = (res, code, message) =>
  json(res, 401, { error: { code, message, details: null } });

const SESSION = {
  login: "alice",
  display_name: "Alice Ash",
  email: "alice@example.com",
  company: "ACME",
  companies: ["ACME", "OTHER"],
  capabilities: ["journal.read"],
  must_change_password: false,
  mfa_pending: false,
};

// The company the session is acting in, so a switch is observable.
let actingIn = "ACME";
// Whether the second factor has been answered, so the stub stops refusing afterwards.
let verified = false;

createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  req.resume();
  console.error(`${req.method} ${req.url} cookie=${req.headers.cookie ?? "-"}`);
  if (path === "/api/v1/health") return json(res, 200, { version: "stub" });
  if (path === "/api/v1/auth/login") {
    return json(res, 200, { ...SESSION, company: actingIn, mfa_pending: mode === "mfa" }, {
      "Set-Cookie": "erpv1_session=stub-token; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600",
    });
  }
  if (path === "/api/v1/auth/logout") {
    res.writeHead(204);
    return res.end();
  }
  if (path === "/api/v1/auth/mfa/verify") {
    verified = true;
    return json(res, 200, { ...SESSION, company: actingIn });
  }
  if (path === "/api/v1/auth/session") {
    if (mode === "deny") return refuse(res, "unauthenticated", "sign in");
    if (mode === "mfa" && !verified) return refuse(res, "mfa_required", "answer the second factor");
    return json(res, 200, { ...SESSION, company: actingIn, mfa_pending: mode === "pending" && !verified });
  }
  const hasCookie = String(req.headers.cookie ?? "").includes("erpv1_session=");
  if (mode !== "ok" && mode !== "forbidden" && !verified) {
    return hasCookie
      ? refuse(res, "mfa_required", "answer the second factor")
      : refuse(res, "unauthenticated", "sign in");
  }
  if (path === "/api/v1/auth/company") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    return req.on("end", () => {
      actingIn = JSON.parse(body).company;
      console.error(`  -> now acting in ${actingIn}`);
      json(res, 200, { ...SESSION, company: actingIn });
    });
  }
  if (path === "/api/v1/companies/current") {
    return json(res, 200, {
      code: "ACME",
      name: "Acme Trading",
      base_currency: "USD",
      fiscal_year_start_month: 1,
      cash_drawer_required: false,
    });
  }
  if (path === "/api/v1/journal-entries") {
    if (mode === "forbidden") {
      return json(res, 403, { error: { code: "forbidden", message: "'alice' may not 'journal.read'", details: null } });
    }
    return json(res, 200, { items: [], limit: 10, offset: 0, total: 0 });
  }
  return json(res, 404, { error: { code: "not_found", message: "stub: unmodelled route", details: null } });
}).listen(8000, () => console.log(`stub backend on :8000 mode=${mode}`));

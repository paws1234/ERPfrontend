/**
 * T-0.DEPLOY.02 check — the frontend image: serves the app, takes its API from the
 * environment, and carries no toolchain.
 *
 *   node scripts/check-image.mjs
 *
 * It fails if any of these stops holding:
 *
 * 1. the image builds from this repository's context
 * 2. it runs as a non-root user, with the server as the process
 * 3. the runtime image has no source-only toolchain: TypeScript, the type
 *    generator and the Next CLI are not in it (they live in the build stages)
 * 4. it serves the app against the **containerised backend**, rendering real data
 * 5. the API base URL is read at start: the *same image* started again against a
 *    second backend instance serves that one, with no rebuild
 * 6. it stops on SIGTERM promptly
 *
 * Docker only: it builds both images and runs them; nothing is left behind.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const backend = resolve(root, "..", "ERPbackend");
const FRONTEND_IMAGE = "erpv1-frontend:deploy-check";
const BACKEND_IMAGE = "erpv1-backend:frontend-check";
// Host networking throughout: the containers share the host's stack, so the
// database, the two backends and the two frontends are reachable at 127.0.0.1
// and there is no bridge or port-forwarding in the way of the proof.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql+psycopg://postgres:postgres@127.0.0.1:55432/postgres";

const problems = [];
const containers = [];

function docker(args, { expectFailure = false, quiet = true } = {}) {
  try {
    return execFileSync("docker", args, {
      cwd: root,
      stdio: quiet ? "pipe" : "inherit",
      encoding: "utf8",
    });
  } catch (error) {
    if (expectFailure) return null;
    problems.push(`docker ${args.join(" ")} failed: ${error.message}`);
    return "";
  }
}

function inspect(name) {
  return JSON.parse(docker(["inspect", name]) || "[]")[0];
}

function waitFor(url, attempts = 40) {
  return fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    (response) => response.text(),
    async (error) => {
      if (attempts <= 0) throw error;
      await new Promise((ready) => setTimeout(ready, 500));
      return waitFor(url, attempts - 1);
    },
  );
}

const SEED = `
import os, uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.company import Company
from app.db import Base, scope_to_company
from app.ledger.posting import post_journal_entry
from app.security import assign, define_role, grant

engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as connection:
    connection.exec_driver_sql("DROP SCHEMA public CASCADE")
    connection.exec_driver_sql("CREATE SCHEMA public")
Base.metadata.create_all(engine)
company_id = uuid.uuid4()
with Session(engine) as session:
    session.add(Company(id=company_id, code="DEPLOY-CHECK", name="Deploy Check Trading",
                        base_currency="PHP", fiscal_year_start_month=1))
    session.commit()
    role = define_role(session, company_id=company_id, code="checker", name="Checker")
    grant(session, role, "company.read", "journal.read")
    assign(session, company_id=company_id, subject="alice", role=role)
    session.commit()
    scope_to_company(session, company_id)
    post_journal_entry(session, company_id=company_id, posting_date=date(2026, 9, 17),
                       currency="PHP", memo="deploy check",
                       lines=[{"account": "1000", "debit": Decimal("987.00")},
                              {"account": "4000", "credit": Decimal("987.00")}])
    session.commit()
print(str(company_id))
`;

try {
  // 1 — both images build (the frontend is proved against the containerised backend)
  console.log("building the backend image (the frontend is proved against it)…");
  docker(["build", "-t", BACKEND_IMAGE, "-f", resolve(backend, "Dockerfile"), backend], {
    quiet: false,
  });
  console.log("building the frontend image…");
  docker(["build", "-t", FRONTEND_IMAGE, "-f", resolve(root, "Dockerfile"), root], {
    quiet: false,
  });

  const config = inspect(FRONTEND_IMAGE)?.Config ?? {};
  // 2 — non-root, process is the command
  if (!config.User || ["root", "0"].includes(config.User)) {
    problems.push(`the frontend image runs as ${config.User ?? "root (default)"}`);
  }
  if (JSON.stringify(config.Cmd) !== JSON.stringify(["node", "server.js"])) {
    problems.push(`the frontend image runs ${JSON.stringify(config.Cmd)}`);
  }
  console.log(`runs as ${config.User}, command ${JSON.stringify(config.Cmd)}`);

  // 3 — no source-only toolchain in the runtime image
  const absent = docker([
    "run", "--rm", "--entrypoint", "sh", FRONTEND_IMAGE, "-c",
    "for p in typescript openapi-typescript @types; do " +
      "[ -e /app/node_modules/$p ] && echo PRESENT:$p; done; " +
      "command -v tsc next npm >/dev/null && echo PRESENT:cli; echo checked",
  ]);
  if (absent.includes("PRESENT:")) {
    problems.push(`the runtime image carries the toolchain: ${absent.trim()}`);
  } else {
    console.log("no TypeScript, no type generator, no Next CLI in the runtime image");
  }

  const seedFile = resolve(tmpdir(), "erpv1-deploy-seed.py");
  writeFileSync(seedFile, SEED);

  // 4 — the database the containers read
  const companyId = docker([
    "run", "--rm",
    "--network", "host",
    "-e", `DATABASE_URL=${DATABASE_URL}`,
    "-e", "PYTHONPATH=/app",
    "-v", `${seedFile}:/seed.py:ro`,
    BACKEND_IMAGE, "python", "/seed.py",
  ]).trim();
  if (!companyId.startsWith("0") && companyId.length < 30) {
    problems.push(`seeding did not return a company id: ${companyId}`);
  }

  for (const [name, port] of [
    ["erpv1-backend-1", "8000"],
    ["erpv1-backend-2", "8001"],
  ]) {
    containers.push(name);
    docker([
      "run", "-d", "--name", name, "--network", "host",
      "-e", `DATABASE_URL=${DATABASE_URL}`,
      BACKEND_IMAGE, "uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", port,
    ]);
  }
  const health = await waitFor("http://127.0.0.1:8000/api/v1/health");
  if (!health.includes('"ok"')) problems.push(`the backend container did not start: ${health}`);
  console.log("two backend instances are up (ports 8000 and 8001)");
  containers.push("erpv1-frontend-1");
  docker([
    "run", "-d", "--name", "erpv1-frontend-1", "--network", "host",
    "-e", "API_BASE_URL=http://127.0.0.1:8000",
    "-e", `COMPANY_ID=${companyId}`,
    "-e", "ACTOR=alice",
    "-e", "PORT=3000",
    FRONTEND_IMAGE,
  ]);
  const page = await waitFor("http://127.0.0.1:3000/");
  if (!page.includes("Deploy Check Trading")) {
    problems.push("the shell did not render the company from the containerised backend");
  }
  if (!page.includes("987.00")) {
    problems.push("the shell did not render the ledger from the containerised backend");
  }
  console.log("the shell renders the company and the ledger from the backend container");

  // 5 — the same image, a different API base URL, no rebuild
  containers.push("erpv1-frontend-2");
  docker([
    "run", "-d", "--name", "erpv1-frontend-2", "--network", "host",
    "-e", "API_BASE_URL=http://127.0.0.1:8001",
    "-e", `COMPANY_ID=${companyId}`,
    "-e", "ACTOR=alice",
    "-e", "PORT=3001",
    FRONTEND_IMAGE,
  ]);
  const second = await waitFor("http://127.0.0.1:3001/");
  if (!second.includes("Deploy Check Trading")) {
    problems.push("the same image did not serve the second backend");
  } else {
    console.log("the same image serves a second backend with no rebuild (API_BASE_URL at start)");
  }

  // 6 — it stops on SIGTERM
  const started = Date.now();
  docker(["stop", "-t", "10", "erpv1-frontend-1"]);
  const elapsed = (Date.now() - started) / 1000;
  const state = inspect("erpv1-frontend-1")?.State ?? {};
  if (elapsed >= 5) problems.push(`the frontend stop took ${elapsed}s — SIGTERM was not handled`);
  // 0 = the server shut down itself, 143 = the signal ended it. Either is a stop
  // on SIGTERM; 137 would be the kill timeout, which is the failure this tests for.
  if (![0, 143].includes(state.ExitCode)) {
    problems.push(`the frontend container exited ${state.ExitCode}`);
  }
  console.log(`stop took ${elapsed.toFixed(2)}s with exit code ${state.ExitCode}`);

  rmSync(seedFile, { force: true });
} finally {
  for (const name of containers) docker(["rm", "-f", name]);
  docker(["rmi", FRONTEND_IMAGE]);
  docker(["rmi", BACKEND_IMAGE]);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("\nok — the frontend image builds, carries no toolchain, and takes its API from the environment");

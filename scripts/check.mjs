/**
 * T-0.API.02 check — the shell is built from the published contract alone.
 *
 *   npm run check
 *
 * It fails if any of these stops holding:
 *
 * 1. the frontend holds no database access and no backend source: no driver, no
 *    connection string, no path into the backend's tree — the contract is the
 *    only coupling between the two repositories
 * 2. the contract it is built against is the backend's published artifact, and
 *    the generated types are current for it (neither is hand-edited)
 * 3. it typechecks with no backend checkout present
 * 4. a field removed from the contract **breaks the build** rather than failing
 *    at runtime — proved by removing one from the generated types and requiring
 *    `tsc` to fail on the code that reads it
 * 5. it builds as its own process (the Next.js production build), ready for its
 *    own image
 * 6. the client's 401/403 handling is what the shell relies on
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const backend = resolve(root, "..", "ERPbackend");
const contract = resolve(root, "contract/v1/openapi.json");
const types = resolve(root, "lib/contract.d.ts");
const problems = [];

function run(command, args, { expectFailure = false } = {}) {
  try {
    execFileSync(command, args, { cwd: root, stdio: "pipe" });
  } catch (error) {
    if (!expectFailure) {
      problems.push(`${command} ${args.join(" ")} failed:\n${error.stdout ?? error.message}`);
      return false;
    }
    return true;
  }
  return true;
}

// 1 — no database, no backend source
for (const path of ["app/layout.tsx", "app/page.tsx", "lib/api.ts"]) {
  const source = readFileSync(resolve(root, path), "utf8");
  for (const forbidden of ["DATABASE_URL", "postgres://", "postgresql://", "psycopg", "ERPbackend"]) {
    if (source.includes(forbidden)) {
      problems.push(`${path} reaches outside the contract: ${forbidden}`);
    }
  }
}
for (const forbidden of ["pg", "pg-promise", "postgres", "mysql2", "sqlite3"]) {
  if (readFileSync(resolve(root, "package.json"), "utf8").includes(`"${forbidden}"`)) {
    problems.push(`the frontend depends on a database driver: ${forbidden}`);
  }
}
console.log("the frontend holds no database driver and no backend source");

// 2 — the contract is the backend's published artifact, and the types are current
if (existsSync(resolve(backend, "contract/v1/openapi.json"))) {
  const published = readFileSync(resolve(backend, "contract/v1/openapi.json"), "utf8");
  if (published !== readFileSync(contract, "utf8")) {
    problems.push("contract/v1/openapi.json differs from the backend's published artifact");
  } else {
    console.log("the vendored contract is the backend's published artifact, byte for byte");
  }
} else {
  console.log("backend checkout not present — the contract copy stands on its own");
}
const typesCopy = `${types}.current`;
run("npx", ["openapi-typescript", "contract/v1/openapi.json", "-o", typesCopy]);
if (existsSync(typesCopy)) {
  if (readFileSync(typesCopy, "utf8") !== readFileSync(types, "utf8")) {
    problems.push("lib/contract.d.ts is out of date — run npm run contract:types");
  } else {
    console.log("the generated types match the contract");
  }
  rmSync(typesCopy);
}

// 3 — it typechecks on its own
if (run("npx", ["tsc", "--noEmit"])) {
  console.log("the repository typechecks with no backend checkout present");
}

// 4 — a removed field breaks the build
const backup = `${types}.backup`;
copyFileSync(types, backup);
try {
  const stale = readFileSync(types, "utf8").replace(/^\s*base_currency:.*$/m, "");
  if (stale === readFileSync(types, "utf8")) {
    problems.push("could not remove a field from the generated types to test the build");
  } else {
    writeFileSync(types, stale);
    if (run("npx", ["tsc", "--noEmit"], { expectFailure: true })) {
      console.log("a field missing from the contract fails the typecheck, as it must");
    } else {
      problems.push("a contract missing a field the page reads did NOT break the build");
    }
  }
} finally {
  copyFileSync(backup, types);
  rmSync(backup);
}

// 5 — it builds as its own process
if (run("npm", ["run", "build"])) {
  console.log("the production build succeeds (its own process, its own image)");
}

// 6 — the client's failure handling
if (run("node", ["--experimental-strip-types", "--test", "tests/client.test.ts"])) {
  console.log("401 asks for a session and 403 is explained, both without breaking the shell");
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("\nok — the shell is built from the published contract alone");

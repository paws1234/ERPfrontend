/**
 * Pull the backend's published contract artifact and regenerate the client types.
 *
 * The frontend repository is built from the contract alone — no backend checkout,
 * no shared tree. `CONTRACT_URL` points at the artifact as this instance pins it
 * (a release pins a tag; the default follows the repository's default branch), so
 * "which contract is this built against" is answered by one URL.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const target = resolve(root, "contract/v1/openapi.json");

const url =
  process.env.CONTRACT_URL ??
  "https://raw.githubusercontent.com/paws1234/ERPbackend/main/contract/v1/openapi.json";

const response = await fetch(url);
if (!response.ok) {
  console.error(`could not pull the contract from ${url}: ${response.status}`);
  process.exit(1);
}
const contract = await response.json();
if (contract?.openapi === undefined || contract?.paths === undefined) {
  console.error(`the artifact at ${url} is not an OpenAPI document`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`pulled ${url} -> ${target}`);

execFileSync("npx", ["openapi-typescript", "contract/v1/openapi.json", "-o", "lib/contract.d.ts"], {
  cwd: root,
  stdio: "inherit",
});
console.log("regenerated lib/contract.d.ts");

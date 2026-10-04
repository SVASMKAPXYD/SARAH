// Pushes selected vars from an env file to Azure App Service app settings.
//
//   node scripts/sync-env.mjs                  # keys listed in scripts/azure-env-keys.txt
//   node scripts/sync-env.mjs GEMINI_API_KEY   # only these keys (overrides the list)
//   node scripts/sync-env.mjs --dry-run        # show key names, change nothing
//
// Env overrides: ENV_FILE (default .env.production), AZURE_RESOURCE_GROUP, AZURE_APP_NAME.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP ?? "girlhacks2026";
const APP_NAME = process.env.AZURE_APP_NAME ?? "girlhacksbackend";
const ENV_FILE = process.env.ENV_FILE ?? ".env.production";
const KEYS_FILE = "scripts/azure-env-keys.txt";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const argKeys = args.filter((a) => !a.startsWith("--"));

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const keys = argKeys.length
  ? argKeys
  : existsSync(KEYS_FILE)
    ? readFileSync(KEYS_FILE, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : fail(`No keys given and ${KEYS_FILE} not found.`);

if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} not found.`);

const parsed = {};
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let value = m[2];
  if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
  parsed[m[1]] = value;
}

const settings = {};
for (const key of keys) {
  if (!(key in parsed)) fail(`${key} is not in ${ENV_FILE}.`);
  if (parsed[key] === "") fail(`${key} is empty in ${ENV_FILE}; refusing to sync a blank value.`);
  settings[key] = parsed[key];
}

console.log(`${dryRun ? "[dry run] " : ""}Syncing to ${APP_NAME} (${RESOURCE_GROUP}): ${Object.keys(settings).join(", ")}`);
if (dryRun) process.exit(0);

// Values go through a temp JSON file so quoting and special characters survive.
const dir = mkdtempSync(join(tmpdir(), "sync-env-"));
const file = join(dir, "settings.json");
try {
  writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
  execFileSync(
    "az",
    ["webapp", "config", "appsettings", "set", "-g", RESOURCE_GROUP, "-n", APP_NAME, "--settings", `@${file}`, "-o", "none"],
    { stdio: "inherit" },
  );
  console.log("Done. App settings updated (the app restarts).");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

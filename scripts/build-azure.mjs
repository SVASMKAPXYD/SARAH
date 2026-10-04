// Builds the standalone bundle and copies the assets it doesn't include,
// leaving .next/standalone ready to deploy with `node server.js`.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npm run build");

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) {
  console.error(`${out}/server.js missing. Is output: "standalone" set in next.config.ts?`);
  process.exit(1);
}

rmSync(`${out}/public`, { recursive: true, force: true });
rmSync(`${out}/.next/static`, { recursive: true, force: true });
if (existsSync("public")) cpSync("public", `${out}/public`, { recursive: true });
mkdirSync(`${out}/.next`, { recursive: true });
cpSync(".next/static", `${out}/.next/static`, { recursive: true });

console.log(`\nReady to deploy: ${out}`);

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./runtime-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const localEnv = path.join(root, ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");

const secretDirectory = mkdtempSync(path.join(tmpdir(), "detector-"));
const secretFile = path.join(secretDirectory, "runtime.env");
writeFileSync(secretFile, `RIOT_API_KEY=${JSON.stringify(process.env.RIOT_API_KEY?.trim() || "")}\n`, { mode: 0o600 });

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    unlinkSync(secretFile);
    rmdirSync(secretDirectory);
  } catch {
    return;
  }
}

const extraArgs = process.argv.slice(2);
const option = (name, value) => extraArgs.some((arg) => arg === name || arg.startsWith(`${name}=`)) ? [] : [name, String(value)];
const child = spawn(process.execPath, [
  path.join(root, "node_modules/wrangler/bin/wrangler.js"),
  "dev", ...option("--config", path.join(root, "dist/server/wrangler.json")),
  "--local", ...option("--persist-to", path.join(root, ".wrangler/state")),
  ...option("--ip", host), ...option("--port", port), ...option("--inspector-port", 0),
  ...option("--env-file", secretFile), ...option("--log-level", "warn"), ...extraArgs,
], { stdio: "inherit" });

child.once("error", (error) => {
  console.error(error.message);
  cleanup();
  process.exitCode = 1;
});
child.once("exit", (code) => {
  cleanup();
  process.exitCode = code ?? 0;
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("exit", cleanup);

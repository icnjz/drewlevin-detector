import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
if (resolve(gitRoot) !== resolve(root)) throw new Error("Initialize a Git repository in this project before checking it.");

 
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
}).split("\0").filter(Boolean))];
const patterns = [
  ["Riot API token", /RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub access token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key", /AKIA[A-Z0-9]{16}/],
];
const problems = [];
for (const file of files) {
  if (/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|riot\.txt)$/.test(file) && file !== ".env.example") {
    problems.push(`${file}: private configuration file`);
  }
  if (/(^|\/)(?:node_modules|\.next|\.vinext|\.wrangler|dist|secrets)\//.test(file) || /\.(?:pem|key|p12|pfx)$/.test(file)) {
    problems.push(`${file}: generated state or secret material`);
  }
  let content;
  try { content = readFileSync(resolve(root, file)).toString("utf8"); }
  catch { problems.push(`${file}: cannot inspect file`); continue; }
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) problems.push(`${file}: ${label}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} publishable files: no recognized secrets or private runtime files.`);
}

#!/usr/bin/env node
// Builds the Chrome Web Store upload: dist/openparty-<version>.zip, containing
// the extension folder exactly as it is in the repository.
//
//   node tools/package.mjs        (or: npm run package)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));

// Guard against shipping a development setup: local servers and required site access.
for (const cs of manifest.content_scripts || []) {
  for (const m of cs.matches) {
    if (/localhost|127\.0\.0\.1/.test(m)) throw new Error(`content script matches a local server: ${m}`);
  }
}
if (manifest.host_permissions) throw new Error("host_permissions must stay optional (optional_host_permissions)");

const out = path.join(ROOT, "dist", `openparty-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
// -X drops extra file attributes; hidden files (.DS_Store and the like) stay out.
execFileSync("zip", ["-r", "-X", "-q", out, ".", "-x", ".*", "*/.*"], { cwd: EXT });

const files = execFileSync("unzip", ["-Z1", out], { encoding: "utf8" }).trim().split("\n");
console.log(`${path.relative(ROOT, out)}: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} KiB`);

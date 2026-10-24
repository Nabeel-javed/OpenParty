import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ext = (p) => new URL(`../extension/${p}`, import.meta.url);
const read = (p) => readFileSync(ext(p), "utf8");

test("manifest references existing files and asks for minimal permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const f of files) assert.ok(existsSync(ext(f)), `missing ${f}`);
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined, "site access must stay optional");
  // Nothing runs outside a party, except the invite hand-off on OpenParty's own invite pages.
  for (const cs of manifest.content_scripts || []) {
    assert.deepEqual(cs.js, ["invite/invite.js"]);
    for (const m of cs.matches) assert.match(m, /^https?:\/\/[^/*]+\/j\/\*$/, `${m} must only match invite pages`);
    files.push(...cs.js);
  }
  for (const f of files) assert.ok(existsSync(ext(f)), `missing ${f}`);
  assert.equal(manifest.web_accessible_resources, undefined, "sites must not be able to detect the extension");
});

test("every injected and imported script exists and parses", () => {
  const bg = read("background.js");
  const contentFiles = [...bg.match(/const CONTENT_FILES = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const pageFiles = [...bg.matchAll(/file: "([^"]+)"/g)].map((m) => m[1]);
  const imported = [...bg.match(/importScripts\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const base = new URL("chrome-extension://x/");
  const pages = ["popup/popup.html", "options/options.html", "join/join.html"].flatMap((page) =>
    [...read(page).matchAll(/<script src="([^"]+)"/g)].map((m) => new URL(m[1], new URL(page, base)).pathname.slice(1)),
  );
  assert.ok(["popup/popup.js", "options/options.js", "join/join.js"].every((f) => pages.includes(f)));
  assert.ok(contentFiles.length >= 8);
  assert.equal(contentFiles.at(-1), "content/main.js", "main.js must run last");
  for (const f of ["background.js", ...contentFiles, ...pageFiles, ...imported, ...pages]) {
    assert.ok(existsSync(ext(f)), `missing ${f}`);
    execFileSync(process.execPath, ["--check", ext(f).pathname]);
  }
});

test("content scripts never assign innerHTML", () => {
  for (const f of ["content/ui.js", "content/main.js", "content/ns.js", "content/sync.js"]) {
    const code = read(f).replace(/\/\/.*$/gm, "");
    assert.ok(!/\.innerHTML\s*=/.test(code), `${f} assigns innerHTML`);
  }
});

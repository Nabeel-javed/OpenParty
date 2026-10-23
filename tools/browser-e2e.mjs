#!/usr/bin/env node
// End-to-end test of the real extension in Chromium, driven over the DevTools
// protocol. Two tabs (host and guest) watch the same local video; the test
// checks that play, pause and seek propagate, chat flows and host lock holds.
//
//   node tools/browser-e2e.mjs --chromium /path/to/Chromium --video clip.webm [--workdir dir] [--headful]
//
// The video must be seekable, at least ~2 minutes long and have an audio track
// (Chromium pauses audio-less videos in background tabs). One way to make one:
//   ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=10:duration=180" -f lavfi -i anullsrc=r=48000:cl=mono \
//     -t 180 -c:v libvpx-vp9 -b:v 150k -c:a libopus clip.webm

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.chromium || !args.video) {
  console.error("usage: node tools/browser-e2e.mjs --chromium <path> --video <clip.webm> [--workdir dir] [--headful]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = () => 20000 + Math.floor(Math.random() * 30000);
const work = args.workdir ? path.resolve(args.workdir) : fs.mkdtempSync(path.join(os.tmpdir(), "openparty-e2e-"));
fs.mkdirSync(work, { recursive: true });
const children = [];
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `  (${detail})` : ""}`);
}

// ---- servers -------------------------------------------------------------

async function startSyncServer(p) {
  const child = spawn(process.execPath, [path.join(ROOT, "server/node/server.js")], {
    env: { ...process.env, PORT: String(p) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  await new Promise((resolve) => child.stdout.on("data", (d) => d.toString().includes("listening") && resolve()));
}

function startPageServer(p, videoPath) {
  const page = `<!doctype html><html><head><title>OpenParty test video</title></head>
<body style="margin:0;background:#000"><video src="/clip.webm" controls style="width:960px;height:540px"></video></body></html>`;
  const size = fs.statSync(videoPath).size;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/watch")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page);
    }
    if (req.url === "/clip.webm") {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Number(range[2]) : size - 1;
      res.writeHead(range ? 206 : 200, {
        "content-type": "video/webm",
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
        ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
      });
      return fs.createReadStream(videoPath, { start, end }).pipe(res);
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(p, "127.0.0.1", () => resolve(server)));
}

// A copy of the extension with test-only host access and the test server as default.
function prepareExtension(syncUrl) {
  const dest = path.join(work, "extension");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "extension"), dest, { recursive: true });
  const manifestPath = path.join(dest, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const utilPath = path.join(dest, "shared/util.js");
  const util = fs.readFileSync(utilPath, "utf8").replace(/const DEFAULT_SERVER_URL = "[^"]*";/, `const DEFAULT_SERVER_URL = "${syncUrl}";`);
  fs.writeFileSync(utilPath, util);
  return dest;
}

// ---- minimal CDP client --------------------------------------------------

class CDP {
  static async connect(debugPort) {
    let info;
    for (let i = 0; i < 100 && !info; i++) {
      info = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        .then((r) => r.json())
        .catch(() => null);
      if (!info) await sleep(100);
    }
    if (!info) throw new Error("Chromium did not expose DevTools");
    const cdp = new CDP(new WebSocket(info.webSocketDebuggerUrl));
    await new Promise((r) => cdp.ws.addEventListener("open", r, { once: true }));
    return cdp;
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(sessionId, expression) {
    const res = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }
}

// ---- the test ------------------------------------------------------------

async function main() {
  const syncPort = port();
  const pagePort = port();
  const debugPort = port();
  const syncUrl = `http://127.0.0.1:${syncPort}`;
  const pageUrl = `http://127.0.0.1:${pagePort}/watch.html`;

  await startSyncServer(syncPort);
  const pageServer = await startPageServer(pagePort, path.resolve(args.video));
  const extPath = prepareExtension(syncUrl);

  // A fresh profile each run: Chromium caches extension service workers.
  const profile = path.join(work, "profile");
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(
    args.chromium,
    [
      `--user-data-dir=${profile}`,
      `--load-extension=${extPath}`,
      `--disable-extensions-except=${extPath}`,
      `--remote-debugging-port=${debugPort}`,
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(args.headful ? [] : ["--headless=new"]),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  children.push(chrome);
  const cdp = await CDP.connect(debugPort);

  // OpenParty's service worker (some Chromium builds run other extensions too).
  let sw = null;
  for (let i = 0; i < 100 && !sw; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const t of targetInfos.filter((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"))) {
      const session = await cdp.attach(t.targetId);
      const name = await cdp.eval(session, "chrome.runtime.getManifest().name").catch(() => null);
      if (name === "OpenParty") {
        sw = session;
        break;
      }
    }
    if (!sw) await sleep(100);
  }
  if (!sw) throw new Error("OpenParty service worker not found");
  await cdp.eval(sw, `chrome.storage.local.set({ serverUrl: ${JSON.stringify(syncUrl)}, name: "Tester" })`);

  async function openTab() {
    const { targetId } = await cdp.send("Target.createTarget", { url: pageUrl });
    const session = await cdp.attach(targetId);
    for (let i = 0; i < 100; i++) {
      if (await cdp.eval(session, "!!document.querySelector('video') && document.querySelector('video').readyState >= 1").catch(() => false)) break;
      await sleep(100);
    }
    const ids = await cdp.eval(sw, `chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
    return { session, tabId: Math.max(...ids) };
  }
  const video = (s, expr) => cdp.eval(s, `(() => { const v = document.querySelector('video'); return ${expr}; })()`);
  const pos = async (s) => video(s, "({ t: v.currentTime, paused: v.paused })");

  const host = await openTab();
  await video(host.session, "(v.currentTime = 20, v.play(), true)");
  await sleep(1000);

  const started = await cdp.eval(sw, `startParty(${host.tabId}, { controlLock: false })`);
  check("host starts a party", !!started.ok, started.error || started.partyId);
  await sleep(2500);
  let h = await pos(host.session);
  check("host keeps its position when the party starts", !h.paused && h.t > 21, `t=${h.t.toFixed(1)}`);
  check("party panel is injected", await cdp.eval(host.session, "!!document.querySelector('openparty-panel')"));

  const guest = await openTab();
  const joined = await cdp.eval(sw, `joinParty(${guest.tabId}, ${JSON.stringify(`${started.partyId}@127.0.0.1:${syncPort}`)})`);
  check("guest joins with the invite code", !!joined.ok, joined.error || "");
  await sleep(4000);
  h = await pos(host.session);
  let g = await pos(guest.session);
  check("guest catches up to the host", !g.paused && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await video(host.session, "(v.pause(), true)");
  await sleep(2500);
  h = await pos(host.session);
  g = await pos(guest.session);
  check("host pause reaches the guest", g.paused && Math.abs(g.t - h.t) < 1, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await video(host.session, "(v.currentTime = 100, true)");
  await sleep(2500);
  g = await pos(guest.session);
  check("host seek reaches the guest", Math.abs(g.t - 100) < 1, `guest ${g.t.toFixed(1)}`);

  await video(guest.session, "(v.play(), true)");
  await sleep(2500);
  h = await pos(host.session);
  g = await pos(guest.session);
  check("guest play reaches the host", !h.paused && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await cdp.eval(sw, `sessions.get(${guest.tabId}).socket.request("chat", { text: "hello from the guest" })`);
  await sleep(500);
  const lastHostMessage = await cdp.eval(sw, `sessions.get(${host.tabId}).room.messages.at(-1)?.text`);
  check("chat reaches the host", lastHostMessage === "hello from the guest");
  const hostUsers = await cdp.eval(sw, `sessions.get(${host.tabId}).room.users.length`);
  check("both members are listed", hostUsers === 2, `${hostUsers} users`);

  await cdp.eval(sw, `sessions.get(${host.tabId}).socket.request("lock", { on: true })`);
  await sleep(500);
  await video(guest.session, "(v.pause(), true)");
  await sleep(2500);
  h = await pos(host.session);
  g = await pos(guest.session);
  check("locked party: guest pause is reverted", !g.paused && !h.paused, `guest paused=${g.paused}`);

  await cdp.eval(sw, `endSession(${guest.tabId})`);
  await sleep(1000);
  const afterLeave = await cdp.eval(sw, `sessions.get(${host.tabId}).room.users.length`);
  check("guest leaves cleanly", afterLeave === 1, `${afterLeave} users`);
  await sleep(5500); // the panel shows a short goodbye note first
  check("guest panel is removed after leaving", !(await cdp.eval(guest.session, "!!document.querySelector('openparty-panel')")));

  pageServer.close();
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: "harness", ok: false });
  })
  .finally(() => {
    for (const child of children) child.kill("SIGTERM");
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });

#!/usr/bin/env node
// End-to-end test of the real extension in Chromium, driven over the DevTools
// protocol. Two tabs (host and guest) watch the same local video; the test
// checks that play, pause and seek propagate, chat flows and host lock holds.
//
//   node tools/browser-e2e.mjs --chromium /path/to/Chromium --video clip.webm [--workdir dir] [--headful] [--screenshot out.png]
//
// With --server https://… the test uses that deployed sync server instead of starting a local one.
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
import { sleep, launchChromium, extensionWorker } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.chromium || !args.video) {
  console.error("usage: node tools/browser-e2e.mjs --chromium <path> --video <clip.webm> [--server url] [--workdir dir] [--headful] [--screenshot out.png]");
  process.exit(2);
}

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

// Serves /watch.html (a plain video page) and, given embedSrc, /embed.html with that page in an iframe.
function startPageServer(p, videoPath, embedSrc) {
  const page = `<!doctype html><html><head><title>OpenParty test video</title></head>
<body style="margin:0;background:#000"><video src="/clip.webm" controls style="width:960px;height:540px"></video></body></html>`;
  const size = fs.statSync(videoPath).size;
  const server = http.createServer((req, res) => {
    if (embedSrc && req.url.startsWith("/spa")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Streaming site</title><h1>Pick a movie</h1>
<iframe src="http://127.0.0.1:9/" width="300" height="60"></iframe>
<script>
  // Like a single-page site: Play opens a modal dialog with the player in a
  // cross-origin iframe, and the dialog traps focus the way UI libraries do.
  window.play = () => {
    const dialog = document.createElement("div");
    dialog.innerHTML = '<button id="close">Close</button><iframe src="${embedSrc}" width="980" height="560" allow="autoplay; fullscreen"></iframe>';
    document.body.append(dialog);
    const inside = dialog.querySelector("button");
    inside.focus();
    document.addEventListener("focusin", (e) => { if (!dialog.contains(e.target)) inside.focus(); });
    document.addEventListener("focusout", (e) => { if (e.relatedTarget && !dialog.contains(e.relatedTarget)) inside.focus(); });
    document.addEventListener("mousedown", (e) => { if (!dialog.contains(e.target)) e.preventDefault(); }, true);
  };
</script>`);
    }
    if (embedSrc && req.url.startsWith("/embed")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Embedded player</title><h1>Some article</h1>
<iframe src="${embedSrc}" width="980" height="560" allow="autoplay; fullscreen"></iframe>`);
    }
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
  manifest.host_permissions = ["<all_urls>"]; // the state after the one-time "allow access"
  const { protocol, hostname } = new URL(syncUrl);
  manifest.content_scripts[0].matches.push(`${protocol}//${hostname}/j/*`); // one-click join from the test server's invite pages
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const utilPath = path.join(dest, "shared/util.js");
  const util = fs.readFileSync(utilPath, "utf8").replace(/const DEFAULT_SERVER_URL = "[^"]*";/, `const DEFAULT_SERVER_URL = "${syncUrl}";`);
  fs.writeFileSync(utilPath, util);
  return dest;
}

// ---- the test ------------------------------------------------------------

async function main() {
  const syncPort = port();
  const pagePort = port();
  const debugPort = port();
  const syncUrl = args.server ? String(args.server).replace(/\/+$/, "") : `http://127.0.0.1:${syncPort}`;
  const syncHost = new URL(syncUrl).host;
  const framePort = port(); // a second origin for the embedded-player scenario
  const pageUrl = `http://127.0.0.1:${pagePort}/watch.html`;
  const embedUrl = `http://127.0.0.1:${pagePort}/embed.html`;
  const frameOrigin = `http://127.0.0.1:${framePort}`;

  if (!args.server) await startSyncServer(syncPort);
  const pageServer = await startPageServer(pagePort, path.resolve(args.video), `${frameOrigin}/watch.html`);
  const frameServer = await startPageServer(framePort, path.resolve(args.video));
  const extPath = prepareExtension(syncUrl);

  const { proc: chrome, cdp } = await launchChromium({
    chromium: args.chromium,
    profile: path.join(work, "profile"),
    extPath,
    debugPort,
    headful: args.headful,
  });
  children.push(chrome);
  const sw = await extensionWorker(cdp, "OpenParty");
  await cdp.eval(sw, `chrome.storage.local.set({ serverUrl: ${JSON.stringify(syncUrl)}, name: "Tester" })`);

  // Opens a tab; with `frame`, the video lives in a cross-origin iframe of that origin.
  async function openTab(url = pageUrl, frame = null) {
    const { targetId } = await cdp.send("Target.createTarget", { url });
    const session = await cdp.attach(targetId);
    const contextId = frame ? await cdp.frameContext(session, frame) : undefined;
    for (let i = 0; i < 100; i++) {
      const ready = "!!document.querySelector('video') && document.querySelector('video').readyState >= 1";
      if (await cdp.eval(session, ready, contextId).catch(() => false)) break;
      await sleep(100);
    }
    const ids = await cdp.eval(sw, `chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
    return { session, contextId, targetId, tabId: Math.max(...ids) };
  }
  const video = (tab, expr) =>
    cdp.eval(tab.session, `(() => { const v = document.querySelector('video'); return ${expr}; })()`, tab.contextId);
  const pos = async (tab) => video(tab, "({ t: v.currentTime, paused: v.paused })");

  const host = await openTab();
  await video(host, "(v.currentTime = 20, v.play(), true)");
  await sleep(1000);

  const started = await cdp.eval(sw, `startParty(${host.tabId}, { controlLock: false })`);
  check("host starts a party", !!started.ok, started.error || started.partyId);
  await sleep(2500);
  let h = await pos(host);
  check("host keeps its position when the party starts", !h.paused && h.t > 21, `t=${h.t.toFixed(1)}`);
  check("party panel is injected", await cdp.eval(host.session, "!!document.querySelector('openparty-panel')"));

  const guest = await openTab();
  const joined = await cdp.eval(sw, `joinParty(${guest.tabId}, ${JSON.stringify(`${started.partyId}@${syncHost}`)})`);
  check("guest joins with the invite code", !!joined.ok, joined.error || "");
  await sleep(4000);
  h = await pos(host);
  let g = await pos(guest);
  check("guest catches up to the host", !g.paused && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await video(host, "(v.pause(), true)");
  await sleep(2500);
  h = await pos(host);
  g = await pos(guest);
  check("host pause reaches the guest", g.paused && Math.abs(g.t - h.t) < 1, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await video(host, "(v.currentTime = 100, true)");
  await sleep(2500);
  g = await pos(guest);
  check("host seek reaches the guest", Math.abs(g.t - 100) < 1, `guest ${g.t.toFixed(1)}`);

  await video(guest, "(v.play(), true)");
  await sleep(2500);
  h = await pos(host);
  g = await pos(guest);
  check("guest play reaches the host", !h.paused && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await cdp.eval(sw, `sessions.get(${guest.tabId}).socket.request("chat", { text: "hello from the guest" })`);
  await sleep(500);
  const lastHostMessage = await cdp.eval(sw, `sessions.get(${host.tabId}).room.messages.at(-1)?.text`);
  check("chat reaches the host", lastHostMessage === "hello from the guest");
  const hostUsers = await cdp.eval(sw, `sessions.get(${host.tabId}).room.users.length`);
  check("both members are listed", hostUsers === 2, `${hostUsers} users`);

  await cdp.eval(sw, `sessions.get(${host.tabId}).socket.request("lock", { on: true })`);
  await sleep(500);
  await video(guest, "(v.pause(), true)");
  await sleep(2500);
  h = await pos(host);
  g = await pos(guest);
  check("locked party: guest pause is reverted", !g.paused && !h.paused, `guest paused=${g.paused}`);

  if (args.screenshot) {
    await cdp.send("Target.activateTarget", { targetId: host.targetId });
    await cdp.eval(sw, `sessions.get(${host.tabId}).sendTop({ op: "show-panel" })`);
    await sleep(800);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, host.session);
    fs.writeFileSync(path.resolve(args.screenshot), Buffer.from(data, "base64"));
    console.log(`  screenshot: ${path.resolve(args.screenshot)}`);
  }

  await cdp.eval(sw, `endSession(${guest.tabId})`);
  await sleep(1000);
  const afterLeave = await cdp.eval(sw, `sessions.get(${host.tabId}).room.users.length`);
  check("guest leaves cleanly", afterLeave === 1, `${afterLeave} users`);
  await sleep(5500); // the panel shows a short goodbye note first
  check("guest panel is removed after leaving", !(await cdp.eval(guest.session, "!!document.querySelector('openparty-panel')")));
  await cdp.eval(sw, `endSession(${host.tabId})`);

  // Embedded player: the video sits in a cross-origin iframe, as on many sites.
  const host2 = await openTab(embedUrl, frameOrigin);
  await video(host2, "(v.currentTime = 30, v.play(), true)");
  await sleep(1000);
  const started2 = await cdp.eval(sw, `startParty(${host2.tabId}, { controlLock: false })`);
  check("embedded player: host starts a party", !!started2.ok, started2.error || "");
  const guest2 = await openTab(embedUrl, frameOrigin);
  const joined2 = await cdp.eval(sw, `joinParty(${guest2.tabId}, ${JSON.stringify(`${started2.partyId}@${syncHost}`)})`);
  check("embedded player: guest joins", !!joined2.ok, joined2.error || "");
  await sleep(4000);
  h = await pos(host2);
  g = await pos(guest2);
  check("embedded player: guest catches up", !g.paused && h.t > 31 && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);
  check("embedded player: panel sits in the top page", await cdp.eval(host2.session, "!!document.querySelector('openparty-panel')"));
  await video(host2, "(v.pause(), true)");
  await sleep(2500);
  h = await pos(host2);
  g = await pos(guest2);
  check("embedded player: pause reaches the guest", g.paused && Math.abs(g.t - h.t) < 1, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);

  await cdp.eval(sw, `endSession(${host2.tabId})`);
  await cdp.eval(sw, `endSession(${guest2.tabId})`);

  // One-click join: the guest only opens the invite link.
  const host3 = await openTab();
  await video(host3, "(v.currentTime = 50, v.play(), true)");
  await sleep(1000);
  const started3 = await cdp.eval(sw, `startParty(${host3.tabId}, { controlLock: false })`);
  const { targetId: guestTarget } = await cdp.send("Target.createTarget", { url: `${syncUrl}/j/${started3.partyId}` });
  const guest3 = { session: await cdp.attach(guestTarget) };
  let landed = false;
  for (let i = 0; i < 100 && !landed; i++) {
    await sleep(100);
    landed = await cdp.eval(guest3.session, `location.href === ${JSON.stringify(pageUrl)}`).catch(() => false);
  }
  check("invite link: guest lands on the video automatically", landed);
  const ids3 = await cdp.eval(sw, `chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
  guest3.tabId = Math.max(...ids3);
  await sleep(4500);
  const status3 = await cdp.eval(sw, `popupStatus(${guest3.tabId})`);
  check("invite link: guest is in the party", status3.inParty && status3.partyId === started3.partyId, `${status3.users.length} users`);
  check("invite link: guest sees the panel", await cdp.eval(guest3.session, "!!document.querySelector('openparty-panel')"));
  h = await pos(host3);
  g = await pos(guest3);
  check("invite link: guest is in sync", !g.paused && h.t > 51 && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);
  await cdp.eval(sw, `endSession(${host3.tabId})`);
  await cdp.eval(sw, `endSession(${guest3.tabId})`);

  // Invite address: a page address carrying #openparty=<code>@<server> joins by itself,
  // even when the site lands the guest on a different page than the host's.
  const host4 = await openTab();
  await video(host4, "(v.currentTime = 70, v.play(), true)");
  await sleep(1000);
  const started4 = await cdp.eval(sw, `startParty(${host4.tabId}, { controlLock: false })`);
  const guest4 = await openTab(`${pageUrl}?ep=2#openparty=${started4.partyId}@${syncHost}`);
  let status4 = null;
  for (let i = 0; i < 60 && !(status4 && status4.inParty && status4.status === "connected"); i++) {
    await sleep(100);
    status4 = await cdp.eval(sw, `popupStatus(${guest4.tabId})`);
  }
  check("invite address: guest joins without the popup", !!status4 && status4.inParty && status4.partyId === started4.partyId);
  await sleep(4000);
  h = await pos(host4);
  g = await pos(guest4);
  check("invite address: guest is in sync", !g.paused && h.t > 71 && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);
  await cdp.eval(guest4.session, `history.pushState({}, "", "?ep=3"), true`); // as a single-page site does
  await sleep(4000);
  const partyVideo = await cdp.eval(sw, `sessions.get(${host4.tabId}).room.video.url`);
  check("a guest on another page doesn't move the party", partyVideo === pageUrl, partyVideo);
  await cdp.eval(sw, `endSession(${host4.tabId})`);
  await cdp.eval(sw, `endSession(${guest4.tabId})`);

  // Single-page site: the player iframe appears only after Play, inside a dialog
  // that traps focus; a blocked frame sits on the page too.
  const spaUrl = `http://127.0.0.1:${pagePort}/spa.html`;
  async function openPlain(url) {
    const { targetId } = await cdp.send("Target.createTarget", { url });
    const session = await cdp.attach(targetId);
    await sleep(1500);
    const ids = await cdp.eval(sw, `chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
    return { session, targetId, tabId: Math.max(...ids) };
  }
  const host5 = await openPlain(spaUrl);
  const started5 = await cdp.eval(sw, `startParty(${host5.tabId}, { controlLock: false })`);
  const guest5 = await openPlain(spaUrl);
  const joined5 = await cdp.eval(sw, `joinParty(${guest5.tabId}, ${JSON.stringify(`${started5.partyId}@${syncHost}`)})`);
  check("single-page site: party starts and guest joins before any video", !!started5.ok && !!joined5.ok, started5.error || joined5.error || "");
  // Press Play in each tab while it's in front, as a person does (Chromium doesn't
  // load media added to a background tab until it's shown).
  for (const tab of [host5, guest5]) {
    await cdp.send("Target.activateTarget", { targetId: tab.targetId });
    await cdp.eval(tab.session, "play(), true");
    await sleep(1500);
  }
  host5.contextId = await cdp.frameContext(host5.session, frameOrigin);
  guest5.contextId = await cdp.frameContext(guest5.session, frameOrigin);
  await sleep(2500);
  await video(host5, "(v.currentTime = 40, v.play(), true)");
  await sleep(4000);
  h = await pos(host5);
  g = await pos(guest5);
  check("single-page site: player added later is synced", !g.paused && h.t > 41 && Math.abs(g.t - h.t) < 1.5, `host ${h.t.toFixed(1)} guest ${g.t.toFixed(1)}`);
  await sleep(3000);

  // Type in the guest's chat box while the dialog traps focus.
  await cdp.eval(sw, `sessions.get(${guest5.tabId}).sendTop({ op: "show-panel" })`);
  await sleep(800);
  await cdp.send("Runtime.enable", {}, guest5.session);
  let panelCtx = null;
  for (let i = 0; i < 50 && !panelCtx; i++) {
    panelCtx = cdp.contexts.findLast((c) => c.sessionId === guest5.session && c.auxData?.type === "isolated" && c.auxData?.frameId === guest5.targetId);
    if (!panelCtx) await sleep(100);
  }
  const box = await cdp.eval(guest5.session, `(() => { const r = OP.ui.$("textarea").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, panelCtx.id);
  await cdp.send("Target.activateTarget", { targetId: guest5.targetId });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, guest5.session);
  }
  await sleep(300);
  await cdp.send("Input.insertText", { text: "typing past the focus trap" }, guest5.session);
  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined }, guest5.session);
  }
  await sleep(800);
  const last5 = await cdp.eval(sw, `sessions.get(${host5.tabId}).room.messages.at(-1)?.text`);
  check("single-page site: guest can type in the chat despite the focus trap", last5 === "typing past the focus trap", String(last5));
  await cdp.eval(sw, `endSession(${host5.tabId})`);
  await cdp.eval(sw, `endSession(${guest5.tabId})`);

  pageServer.close();
  frameServer.close();
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

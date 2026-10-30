#!/usr/bin/env node
// Renders the Chrome Web Store images into store/: four 1280x800 screenshots
// of the real extension in a staged party, plus the promo tiles. A few scripted
// guests join the party over the protocol and chat.
//
//   node tools/store-assets.mjs --chromium /path/to/Chromium --video sintel-reel.webm [--server url] [--headful]
//
// Any Chromium-based browser that still loads unpacked extensions works (Brave does).
// The screenshots use Sintel (© Blender Foundation, sintel.org, CC BY 3.0): a
// 19-second reel of four shots, cut from Wikimedia Commons' 1080p transcode
// (https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f1/Sintel_movie_4K.webm/Sintel_movie_4K.webm.1080p.vp9.webm):
// 4:52.6–4:59.0, 4:42.0–4:46.6, 3:35.2–3:39.6 and 4:46.75–4:50.65, joined in that order and scaled to 1280 px wide.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep, launchChromium, extensionWorker } from "./cdp.mjs";
import { connect } from "../test/helpers/client.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "store");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.chromium || !args.video) {
  console.error("usage: node tools/store-assets.mjs --chromium <path> --video <sintel-reel.webm> [--server url] [--headful]");
  process.exit(2);
}
const SERVER = String(args.server || "https://party.openparty.workers.dev").replace(/\/+$/, "");
const W = 1280;
const H = 800;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "openparty-store-"));
const port = () => 20000 + Math.floor(Math.random() * 30000);

// ---- pages ---------------------------------------------------------------

const watchPage = `<!doctype html><html><head><meta charset="utf-8"><title>Sintel</title></head>
<body style="margin:0;background:#0e0d0b;color:#f3eee3;font:15px system-ui,-apple-system,sans-serif;overflow:hidden">
<video src="/clip.webm" style="display:block;width:${W}px;height:720px;background:#000"></video>
<div style="height:80px;display:flex;flex-direction:column;justify-content:center;padding:0 28px">
  <div style="font-weight:650;font-size:19px">Sintel</div>
  <div style="color:#9c9487;font-size:13px">© Blender Foundation · sintel.org · CC BY 3.0</div>
</div></body></html>`;

function startPageServer(p, extra) {
  const size = fs.statSync(args.video).size;
  const server = http.createServer((req, res) => {
    const html = { "content-type": "text/html; charset=utf-8" };
    if (req.url.startsWith("/watch")) return res.writeHead(200, html).end(watchPage);
    if (extra[req.url]) return res.writeHead(200, html).end(extra[req.url]());
    if (req.url === "/brand/Fraunces-600.woff2") return res.writeHead(200, { "content-type": "font/woff2" }).end(fs.readFileSync(path.join(ROOT, "brand/fonts/Fraunces-600.woff2")));
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
      return fs.createReadStream(args.video, { start, end }).pipe(res);
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(p, "127.0.0.1", () => resolve(server)));
}

// The popup laid over a page screenshot, where Chrome would open it under the toolbar icon.
const popupComposite = (page, popup) => `<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;
background:url(data:image/png;base64,${page}) no-repeat">
<img src="data:image/png;base64,${popup}" style="position:absolute;top:10px;right:18px;border-radius:12px;
box-shadow:0 18px 50px #000a,0 0 0 1px #ffffff1a"></body></html>`;

// Promo tiles in the brand: warm near-black, the lockup, an ivory serif line and a gold rule.
const brandCss = `margin:0;overflow:hidden;color:#f3eee3;background:#0e0d0b;font-family:system-ui,-apple-system,'Segoe UI',sans-serif`;
const fontFace = `<style>@font-face{font-family:Fraunces;src:url(/brand/Fraunces-600.woff2);font-weight:600}
.serif{font-family:Fraunces;font-weight:600;letter-spacing:-.01em}.rule{width:44px;height:3px;border-radius:2px;background:#e9a23b}</style>`;

const smallTile = (lockup) => `<!doctype html><html><head>${fontFace}</head><body style="${brandCss};width:440px;height:280px;
display:flex;flex-direction:column;justify-content:center;padding:0 38px;box-sizing:border-box">
<img src="data:image/png;base64,${lockup}" style="width:250px;margin-left:-14px">
<div class="serif" style="font-size:25px;line-height:1.2;margin-top:16px">Watch videos together,<br>on almost any site.</div>
<div class="rule" style="margin-top:16px"></div>
<div style="font-size:13px;color:#9c9487;margin-top:12px">Free · Open source · No accounts · No tracking</div>
</body></html>`;

const marquee = (lockup, shot) => `<!doctype html><html><head>${fontFace}</head><body style="${brandCss};width:1400px;height:560px;
display:flex;align-items:center;gap:60px;padding:0 0 0 84px;box-sizing:border-box">
<div style="flex:0 0 430px">
  <img src="data:image/png;base64,${lockup}" style="width:340px;margin-left:-18px">
  <div class="serif" style="font-size:38px;line-height:1.15;margin-top:22px">Watch videos together,<br>on almost any site.</div>
  <div class="rule" style="margin-top:22px"></div>
  <div style="font-size:17px;color:#9c9487;margin-top:16px;line-height:1.55">Synced playback, chat and reactions with friends.<br>Free and open source. No accounts, no tracking.</div>
</div>
<img src="data:image/png;base64,${shot}" style="width:760px;border-radius:12px;box-shadow:0 24px 60px #000a,0 0 0 1px #ffffff14">
</body></html>`;

// ---- run -----------------------------------------------------------------

async function main() {
  const pagePort = port();
  const pageUrl = `http://127.0.0.1:${pagePort}/watch.html`;
  const pages = {};
  const pageServer = await startPageServer(pagePort, pages);

  // The extension with site access already granted (the one-time prompt) and the chosen server.
  const extPath = path.join(work, "extension");
  fs.cpSync(path.join(ROOT, "extension"), extPath, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extPath, "manifest.json"), "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  fs.writeFileSync(path.join(extPath, "manifest.json"), JSON.stringify(manifest, null, 2));

  const { proc, cdp } = await launchChromium({
    chromium: args.chromium,
    profile: path.join(work, "profile"),
    extPath,
    debugPort: port(),
    headful: args.headful,
    extraArgs: [`--window-size=${W},${H}`, "--hide-scrollbars"],
  });
  const bots = [];
  try {
    const sw = await extensionWorker(cdp, "OpenParty");
    const extId = (await cdp.eval(sw, "chrome.runtime.id")) || "";
    await cdp.eval(sw, `chrome.storage.local.set({ serverUrl: ${JSON.stringify(SERVER)}, name: "Maya", avatar: "🦊" })`);

    async function open(url, { width = W, height = H, beforeLoad } = {}) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const session = await cdp.attach(targetId);
      await cdp.send("Page.enable", {}, session);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }, session);
      if (beforeLoad) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad }, session);
      await cdp.send("Page.navigate", { url }, session);
      await sleep(1500);
      return session;
    }
    const shoot = async (session, clip) =>
      (await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, session)).data;
    const save = (name, b64) => {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, "base64"));
      console.log(`wrote store/${name}`);
    };

    // Host: Maya starts a party on the video.
    const host = await open(pageUrl);
    await cdp.eval(host, "(() => { const v = document.querySelector('video'); v.currentTime = 5; return v.play().then(() => true); })()");
    const tabId = Math.max(...(await cdp.eval(sw, "chrome.tabs.query({}).then(ts => ts.map(t => t.id))")));
    const started = await cdp.eval(sw, `startParty(${tabId}, { controlLock: false })`);
    if (!started.ok) throw new Error(`could not start a party: ${started.error}`);
    await sleep(1500);

    // Guests join over the protocol, then everyone chats.
    for (const [name, avatar] of [["Leo", "🐼"], ["Priya", "🦄"], ["Sam", "🐸"]]) {
      const bot = await connect(SERVER, started.partyId);
      await bot.request("hello", { action: "join", user: { name, avatar } });
      bots.push(bot);
      await sleep(400);
    }
    const [leo, priya, sam] = bots;
    const hostSay = (text) => cdp.eval(sw, `sessions.get(${tabId}).socket.request("chat", { text: ${JSON.stringify(text)} })`);
    await leo.request("chat", { text: "ok everyone at the same spot?" });
    await sleep(500);
    await priya.request("chat", { text: "yep, perfectly in sync 👌" });
    await sleep(500);
    await hostSay("this little dragon 🥹");
    await sleep(500);
    await sam.request("chat", { text: "no spoilers pls 😂" });
    await sleep(500);
    await leo.request("chat", { text: "popcorn ready 🍿" });
    // Shoot at the same moment of the film every time (Sintel and the little dragon).
    while ((await cdp.eval(host, "document.querySelector('video').currentTime")) < 12.6) await sleep(50);

    // 1: the party panel, with reactions in the air.
    await priya.request("react", { emoji: "😂" });
    await sleep(250);
    await sam.request("react", { emoji: "❤️" });
    await sleep(250);
    await leo.request("react", { emoji: "🔥" });
    await sleep(700);
    save("screenshot-1-party.png", await shoot(host));
    await sleep(3000); // let the reactions finish

    // 2: the toolbar popup over the video.
    await cdp.eval(host, "document.querySelector('openparty-panel').style.display = 'none'");
    const background = await shoot(host);
    const popup = await open(`chrome-extension://${extId}/popup/popup.html`, {
      width: 340,
      height: 600,
      // The real popup belongs to the video's tab; opened as a page it needs pointing there.
      beforeLoad: `chrome.tabs.query = ((query) => (q) => q.active && q.currentWindow ? chrome.tabs.get(${tabId}).then((t) => [t]) : query(q))(chrome.tabs.query.bind(chrome.tabs));`,
    });
    const popupHeight = await cdp.eval(popup, "Math.ceil(document.documentElement.getBoundingClientRect().height)");
    const popupShot = await shoot(popup, { x: 0, y: 0, width: 340, height: popupHeight });
    pages["/popup-composite"] = () => popupComposite(background, popupShot);
    save("screenshot-2-popup.png", await shoot(await open(`http://127.0.0.1:${pagePort}/popup-composite`)));

    // 3: the invite page friends open (shown as served, from another origin so the extension leaves it alone).
    const invite = await fetch(`${SERVER}/j/${started.partyId}`).then((r) => r.text());
    pages["/invite"] = () => invite;
    save("screenshot-3-invite.png", await shoot(await open(`http://127.0.0.1:${pagePort}/invite`)));

    // 4: settings.
    save("screenshot-4-settings.png", await shoot(await open(`chrome-extension://${extId}/options/options.html`)));

    // Promo tiles, using the first screenshot.
    const lockup = fs.readFileSync(path.join(ROOT, "brand/logo-lockup-dark-bg.png")).toString("base64");
    const shot = fs.readFileSync(path.join(OUT, "screenshot-1-party.png")).toString("base64");
    pages["/small"] = () => smallTile(lockup);
    pages["/marquee"] = () => marquee(lockup, shot);
    save("promo-small-440x280.png", await shoot(await open(`http://127.0.0.1:${pagePort}/small`, { width: 440, height: 280 })));
    save("promo-marquee-1400x560.png", await shoot(await open(`http://127.0.0.1:${pagePort}/marquee`, { width: 1400, height: 560 })));

    await cdp.eval(sw, `endSession(${tabId})`);
  } finally {
    for (const bot of bots) bot.close();
    proc.kill("SIGTERM");
    pageServer.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

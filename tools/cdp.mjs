// Minimal Chromium DevTools protocol client, shared by the browser test and
// the store image generator. Uses Node's built-in WebSocket and fetch.

import { spawn } from "node:child_process";
import fs from "node:fs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
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
    this.contexts = []; // Runtime.executionContextCreated payloads, with their session
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method === "Runtime.executionContextCreated") {
        this.contexts.push({ sessionId: msg.sessionId, ...msg.params.context });
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(sessionId, expression, contextId) {
    const params = { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) };
    const res = await this.send("Runtime.evaluate", params, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  }

  // The main-world context of a frame with the given origin inside a page session.
  async frameContext(sessionId, origin) {
    await this.send("Runtime.enable", {}, sessionId);
    for (let i = 0; i < 100; i++) {
      const ctx = this.contexts.find((c) => c.sessionId === sessionId && c.origin === origin && c.auxData && c.auxData.isDefault);
      if (ctx) return ctx.id;
      await sleep(100);
    }
    throw new Error(`no frame context for ${origin}`);
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }
}

// Starts Chromium with a fresh profile (it caches extension service workers) and the given extension.
export async function launchChromium({ chromium, profile, extPath, debugPort, headful = false, extraArgs = [] }) {
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(
    chromium,
    [
      `--user-data-dir=${profile}`,
      ...(extPath ? [`--load-extension=${extPath}`, `--disable-extensions-except=${extPath}`] : []),
      `--remote-debugging-port=${debugPort}`,
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...extraArgs,
      ...(headful ? [] : ["--headless=new"]),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  return { proc, cdp: await CDP.connect(debugPort) };
}

// A session on the service worker of the extension with this manifest name
// (some Chromium builds run other extensions too).
export async function extensionWorker(cdp, name) {
  for (let i = 0; i < 100; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const t of targetInfos.filter((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"))) {
      const session = await cdp.attach(t.targetId);
      const found = await cdp.eval(session, "chrome.runtime.getManifest().name").catch(() => null);
      if (found === name) return session;
    }
    await sleep(100);
  }
  throw new Error(`${name} service worker not found`);
}

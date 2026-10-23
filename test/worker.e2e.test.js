import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomId } from "../server/core/party.js";
import { runScenario } from "./helpers/client.js";

const WORKER_DIR = fileURLToPath(new URL("../server/worker/", import.meta.url));
const WRANGLER = `${WORKER_DIR}node_modules/.bin/wrangler`;
const PORT = 40000 + Math.floor(Math.random() * 20000);
const PARTY = randomId(10);
const BASE = `http://127.0.0.1:${PORT}`;

test("worker end to end (wrangler dev)", { skip: !existsSync(WRANGLER) && "run npm install in server/worker" }, async (t) => {
  const child = spawn(WRANGLER, ["dev", "--port", String(PORT), "--ip", "127.0.0.1", "--show-interactive-dev-session=false"], {
    cwd: WORKER_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  });

  let log = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wrangler dev did not start:\n" + log)), 60_000);
    const onData = (d) => {
      log += d.toString();
      if (/Ready on/i.test(log)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`wrangler exited with ${code}:\n${log}`)));
  });

  assert.equal(await fetch(`${BASE}/healthz`).then((r) => r.text()), "ok");
  await runScenario(t, BASE, assert, PARTY);

  // Keepalive is answered by the hibernation auto-response.
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws/w3m9q2x7pa`);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const pong = new Promise((r) => ws.addEventListener("message", (e) => r(JSON.parse(e.data)), { once: true }));
  ws.send('{"type":"ping"}');
  assert.equal((await pong).type, "pong");
  ws.close();
});

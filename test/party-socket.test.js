import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SERVER = fileURLToPath(new URL("../server/node/server.js", import.meta.url));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

function loadExtensionScripts() {
  const sandbox = { crypto, URL, URLSearchParams, WebSocket, setTimeout, setInterval, clearTimeout, clearInterval, console };
  sandbox.globalThis = sandbox;
  for (const file of ["../extension/shared/util.js", "../extension/background/party-socket.js"]) {
    vm.runInNewContext(readFileSync(new URL(file, import.meta.url), "utf8"), sandbox);
  }
  return sandbox;
}

async function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("listening") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
  return child;
}

const until = async (predicate, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
};

test("party socket creates, syncs clock, and resumes after a server restart", async (t) => {
  const { PartySocket } = loadExtensionScripts();
  let server = await startServer();
  t.after(() => server.kill("SIGTERM"));

  const events = { welcomes: [], pushes: [], statuses: [], clocks: [], fatal: null };
  let identity = null;
  const video = { url: "https://example.com/v/1", title: "Test", durationMs: 0 };
  const socket = new PartySocket(BASE, "s3m9q2x7pa", {
    hello: async ({ recreate }) =>
      identity && !recreate
        ? { action: "join", user: { name: "Ann", avatar: "🐱" }, ...identity }
        : { action: "create", user: { name: "Ann", avatar: "🐱" }, video, playback: { state: "playing", timeMs: 5000 } },
    welcome: (data) => {
      identity = { userId: data.userId, token: data.token };
      events.welcomes.push(data);
    },
    push: (type, data) => events.pushes.push({ type, data }),
    fatal: (error) => (events.fatal = error),
    status: (s) => events.statuses.push(s),
    clock: (offset) => events.clocks.push(offset),
  });
  t.after(() => socket.close());
  socket.connect();

  await until(() => events.welcomes.length === 1);
  assert.equal(events.welcomes[0].room.video.title, "Test");
  await until(() => events.clocks.length > 0);
  assert.ok(Math.abs(socket.offset) < 50, `offset ${socket.offset} should be ~0 on localhost`);

  const reply = await socket.request("state", { state: "playing", timeMs: 1000, at: Date.now() });
  assert.equal(reply.error, undefined);
  await until(() => events.pushes.some((p) => p.type === "state" && p.data.state === "playing"));

  // The in-memory server loses the room on restart; the socket re-creates the
  // party under the same code with the last known position.
  server.kill("SIGTERM");
  await until(() => events.statuses.at(-1) === "reconnecting");
  server = await startServer();
  await until(() => events.welcomes.length === 2, 15_000);
  assert.equal(events.fatal, null);
  assert.equal(events.welcomes[1].partyId, "s3m9q2x7pa");
  assert.equal(events.welcomes[1].room.playback.state, "playing");
  assert.equal(events.welcomes[1].room.playback.timeMs, 5000);
});

test("party socket reports a missing party on first join", async (t) => {
  const { PartySocket } = loadExtensionScripts();
  const server = await startServer();
  t.after(() => server.kill("SIGTERM"));
  let fatal = null;
  const socket = new PartySocket(BASE, "m4pq7zzzzz", {
    hello: async () => ({ action: "join", user: { name: "Bob" } }),
    welcome: () => {},
    push: () => {},
    fatal: (e) => (fatal = e),
    status: () => {},
    clock: () => {},
  });
  t.after(() => socket.close());
  socket.connect();
  await until(() => fatal !== null);
  assert.equal(fatal, "no such party");
});

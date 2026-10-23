import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runScenario, connect } from "./helpers/client.js";

const SERVER = fileURLToPath(new URL("../server/node/server.js", import.meta.url));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("listening") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
  return child;
}

test("node server end to end", async (t) => {
  const child = await startServer();
  t.after(() => child.kill("SIGTERM"));

  assert.equal(await fetch(`${BASE}/healthz`).then((r) => r.text()), "ok");
  assert.equal((await fetch(`${BASE}/j/notaparty`)).status, 404);

  await runScenario(t, BASE, assert, "k3m9q2x7pa");

  // Invalid party ids are refused at upgrade time.
  await assert.rejects(connect(BASE, "BAD"));
});

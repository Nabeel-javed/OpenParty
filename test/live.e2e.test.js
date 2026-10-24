import { test } from "node:test";
import assert from "node:assert/strict";
import { randomId } from "../server/core/party.js";
import { runScenario } from "./helpers/client.js";

// Smoke test for a deployed server; skipped unless OPENPARTY_LIVE_URL is set:
//   OPENPARTY_LIVE_URL=https://openparty.openparty-worker.workers.dev node --test test/live.e2e.test.js
const BASE = process.env.OPENPARTY_LIVE_URL?.replace(/\/+$/, "");

test("deployed server end to end", { skip: !BASE && "set OPENPARTY_LIVE_URL" }, async (t) => {
  assert.equal(await fetch(`${BASE}/healthz`).then((r) => r.text()), "ok");
  assert.equal((await fetch(`${BASE}/j/${randomId(10)}`)).status, 404);
  await runScenario(t, BASE, assert, randomId(10));
});

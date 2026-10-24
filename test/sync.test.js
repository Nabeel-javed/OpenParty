import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = { setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, console };
sandbox.globalThis = sandbox;
sandbox.OP = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
vm.runInNewContext(readFileSync(new URL("../extension/content/sync.js", import.meta.url), "utf8"), sandbox);
const { SyncEngine } = sandbox.OP;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake <video>: time advances in real time while playing; media events fire async like a browser.
class FakePlayer {
  constructor({ timeMs = 0, paused = true, durationMs = 3_600_000 } = {}) {
    this.base = timeMs;
    this.since = Date.now();
    this.isPaused = paused;
    this.duration = durationMs;
    this.ad = false;
    this.isLive = false;
    this.listener = () => {};
    this.calls = [];
  }
  attach(listener) {
    this.listener = listener;
  }
  detach() {}
  emit(type) {
    setTimeout(() => this.listener(type), 0);
  }
  timeMs() {
    return this.isPaused ? this.base : this.base + (Date.now() - this.since);
  }
  durationMs() {
    return this.duration;
  }
  paused() {
    return this.isPaused;
  }
  seeking() {
    return false;
  }
  live() {
    return this.isLive;
  }
  inAd() {
    return this.ad;
  }
  freeze() {
    this.base = this.timeMs();
    this.since = Date.now();
  }
  async play() {
    this.calls.push("play");
    this.freeze();
    this.isPaused = false;
    this.emit("play");
    return "ok";
  }
  async pause() {
    this.calls.push("pause");
    this.freeze();
    this.isPaused = true;
    this.emit("pause");
  }
  async seek(ms) {
    this.calls.push("seek");
    this.base = ms;
    this.since = Date.now();
    this.emit("seeked");
  }
  // user actions
  userPause() {
    this.freeze();
    this.isPaused = true;
    this.emit("pause");
  }
  userSeek(ms) {
    this.base = ms;
    this.since = Date.now();
    this.emit("seeked");
  }
}

function makeEngine(player, cfg = {}) {
  const sent = [];
  const notices = [];
  const engine = new SyncEngine(
    player,
    {
      send: async (op, data) => {
        sent.push({ op, ...data });
        return cfg.reply ? cfg.reply(op, data) : {};
      },
      notify: (kind) => notices.push(kind),
    },
    { tickMs: 50, settleMs: 0 },
  );
  engine.configure({ me: "u_me", offset: 0, locked: false, isHost: true, ...cfg });
  engine.start();
  return { engine, sent, notices };
}

const states = (sent) => sent.filter((m) => m.op === "local-state");

test("a local pause is broadcast with the current position", async (t) => {
  const player = new FakePlayer({ timeMs: 10_000, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "playing", timeMs: 10_000, at: Date.now() } });
  t.after(() => engine.stop());
  await sleep(20);
  player.userPause();
  await sleep(20);
  const [msg] = states(sent);
  assert.equal(msg.state, "paused");
  assert.ok(Math.abs(msg.timeMs - 10_040) < 100);
});

test("applying a remote change does not echo it back", async (t) => {
  const player = new FakePlayer({ timeMs: 5_000, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "playing", timeMs: 5_000, at: Date.now() } });
  t.after(() => engine.stop());
  engine.onRemote({ state: "paused", timeMs: 30_000, at: Date.now() }, "u_other");
  await sleep(150);
  assert.ok(player.isPaused);
  assert.ok(Math.abs(player.timeMs() - 30_000) < 5);
  assert.deepEqual(states(sent), []);
});

test("small remote differences are not chased, big ones are", async (t) => {
  const player = new FakePlayer({ timeMs: 20_000, paused: true });
  const { engine } = makeEngine(player, { playback: { state: "paused", timeMs: 20_000, at: Date.now() } });
  t.after(() => engine.stop());
  engine.onRemote({ state: "paused", timeMs: 20_600, at: Date.now() }, "u_other");
  await sleep(100);
  assert.ok(!player.calls.includes("seek"));
  engine.onRemote({ state: "paused", timeMs: 25_000, at: Date.now() }, "u_other");
  await sleep(100);
  assert.ok(player.calls.includes("seek"));
});

test("the drift tick pulls a lagging player back", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "playing", timeMs: 60_000, at: Date.now() } });
  t.after(() => engine.stop());
  await sleep(150);
  assert.ok(Math.abs(player.timeMs() - engine.expectedMs()) < 200);
  assert.deepEqual(states(sent), [], "corrections are not broadcast");
});

test("a guest in a locked party is reverted, not broadcast", async (t) => {
  const player = new FakePlayer({ timeMs: 1_000, paused: false });
  const { engine, sent, notices } = makeEngine(player, {
    locked: true,
    isHost: false,
    playback: { state: "playing", timeMs: 1_000, at: Date.now() },
  });
  t.after(() => engine.stop());
  player.userPause();
  await sleep(100);
  assert.deepEqual(states(sent), []);
  assert.ok(notices.includes("locked"));
  assert.ok(!player.isPaused, "playback resumed");
});

test("an older echo of our own change is ignored while a newer one is in flight", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: true });
  const { engine, sent } = makeEngine(player, { playback: { state: "paused", timeMs: 0, at: Date.now() } });
  t.after(() => engine.stop());
  player.userSeek(100_000);
  await sleep(10);
  player.userSeek(200_000);
  await sleep(10);
  const [first] = states(sent);
  engine.onRemote({ state: first.state, timeMs: first.timeMs, at: first.at }, "u_me");
  await sleep(100);
  assert.ok(Math.abs(player.timeMs() - 200_000) < 5, "stayed at the newer position");
});

test("ads suspend sync and are announced", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "playing", timeMs: 0, at: Date.now() } });
  t.after(() => engine.stop());
  player.ad = true;
  await sleep(100);
  player.userPause();
  engine.onRemote({ state: "playing", timeMs: 90_000, at: Date.now() }, "u_other");
  await sleep(100);
  assert.deepEqual(states(sent), []);
  assert.ok(!player.calls.includes("seek"));
  assert.ok(sent.some((m) => m.op === "ads" && m.on === true));
});

test("live streams sync play/pause but never seek", async (t) => {
  const player = new FakePlayer({ timeMs: 5_000, paused: false });
  player.isLive = true;
  const { engine } = makeEngine(player, { playback: { state: "playing", timeMs: 900_000, at: Date.now() } });
  t.after(() => engine.stop());
  engine.onRemote({ state: "paused", timeMs: 900_000, at: Date.now() }, "u_other");
  await sleep(100);
  assert.ok(player.isPaused);
  assert.ok(!player.calls.includes("seek"));
});

test("no seeking past the end of our video", async (t) => {
  const player = new FakePlayer({ timeMs: 1_000, paused: true, durationMs: 60_000 });
  const { engine } = makeEngine(player, { playback: { state: "paused", timeMs: 1_000, at: Date.now() } });
  t.after(() => engine.stop());
  engine.onRemote({ state: "paused", timeMs: 59_500, at: Date.now() }, "u_other");
  await sleep(100);
  assert.ok(!player.calls.includes("seek"));
});

test("adopt makes the local state the party state", async (t) => {
  const player = new FakePlayer({ timeMs: 754_000, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "paused", timeMs: 0, at: Date.now() } });
  t.after(() => engine.stop());
  engine.adopt();
  await sleep(10);
  const [msg] = states(sent);
  assert.equal(msg.state, "playing");
  assert.ok(msg.timeMs >= 754_000);
});

test("a locked rejection asks for a resync", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: false });
  const { engine, sent, notices } = makeEngine(player, {
    playback: { state: "playing", timeMs: 0, at: Date.now() },
    reply: (op) => (op === "local-state" ? { error: "locked" } : {}),
  });
  t.after(() => engine.stop());
  player.userPause();
  await sleep(50);
  assert.ok(notices.includes("locked"));
  assert.ok(sent.some((m) => m.op === "resync"));
});

test("pauses forced on a hidden muted tab are neither broadcast nor fought", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: false });
  const { engine, sent } = makeEngine(player, { playback: { state: "playing", timeMs: 0, at: Date.now() } });
  t.after(() => engine.stop());
  player.backgroundSuspended = () => true;
  player.userPause(); // the browser, not the user
  await sleep(150);
  assert.deepEqual(states(sent), []);
  assert.ok(!player.calls.includes("play"), "does not fight the browser");
  player.backgroundSuspended = () => false;
  await sleep(150);
  assert.ok(!player.isPaused, "resumes once the tab is visible again");
});

test("after an ad the player catches up to the party instead of starting over", async (t) => {
  const player = new FakePlayer({ timeMs: 0, paused: false });
  player.ad = true; // joined during a pre-roll ad
  const { engine } = makeEngine(player, { playback: { state: "playing", timeMs: 83_000, at: Date.now() } });
  t.after(() => engine.stop());
  engine.apply("remote");
  await sleep(150);
  assert.ok(!player.calls.includes("seek"), "leaves the ad alone");
  player.ad = false; // ad over: the site starts the video from 0:00
  player.base = 0;
  player.since = Date.now();
  await sleep(200);
  assert.ok(Math.abs(player.timeMs() - engine.expectedMs()) < 300, `at ${player.timeMs()} vs party ${engine.expectedMs()}`);
});

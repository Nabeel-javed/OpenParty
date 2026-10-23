import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  newConnection,
  handleMessage,
  handleClose,
  isEmpty,
  isValidPartyId,
  randomId,
  LIMITS,
} from "../server/core/party.js";

const VIDEO = { url: "https://example.com/watch/1", title: "Episode 1", durationMs: 1_200_000 };
// Deterministic xorshift byte source so test runs are reproducible.
let seed = 0x2545f491;
const rand = (n) =>
  Uint8Array.from({ length: n }, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed & 0xff;
  });

function setup() {
  const room = createRoom("k3m9q2x7pa");
  return { room, now: 1_000_000 };
}

function send(room, conn, type, data, now, id = 1) {
  return handleMessage(room, conn, JSON.stringify({ type, id, data }), now, rand).out;
}

function replyOf(out) {
  return out.find((o) => o.msg.type === "reply").msg;
}

function hello(room, now, action, extra = {}) {
  const conn = newConnection("c" + Math.random(), now);
  const out = send(room, conn, "hello", { action, user: { name: extra.name || "Ann", avatar: "🐱" }, ...extra }, now);
  return { conn, out, reply: replyOf(out) };
}

test("party ids", () => {
  const id = randomId(10);
  assert.equal(id.length, 10);
  assert.ok(isValidPartyId(id));
  assert.ok(!isValidPartyId("ABCDEFGHIJ"));
  assert.ok(!isValidPartyId("short"));
});

test("create then join", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  assert.equal(host.reply.error, undefined);
  assert.equal(host.reply.data.room.hostId, host.reply.data.userId);
  assert.equal(host.reply.data.room.video.title, "Episode 1");

  const guest = hello(room, now + 10, "join", { name: "Bob" });
  assert.equal(guest.reply.error, undefined);
  assert.equal(guest.reply.data.room.users.length, 2);
  assert.ok(guest.out.some((o) => o.to === "others" && o.msg.type === "notice" && o.msg.data.kind === "join"));
});

test("create on existing party and join on missing party fail", () => {
  const { room, now } = setup();
  assert.equal(hello(room, now, "join").reply.error, "no such party");
  hello(room, now, "create", { video: VIDEO });
  assert.equal(hello(room, now, "create", { video: VIDEO }).reply.error, "party exists");
});

test("create requires a valid http(s) video", () => {
  const { room, now } = setup();
  assert.equal(hello(room, now, "create", { video: { url: "javascript:alert(1)" } }).reply.error, "bad video");
  assert.equal(hello(room, now, "create", {}).reply.error, "bad video");
});

test("messages before hello are rejected", () => {
  const { room, now } = setup();
  const conn = newConnection("c1", now);
  assert.equal(replyOf(send(room, conn, "chat", { text: "hi" }, now)).error, "say hello first");
});

test("state is stored, broadcast to all and clamped", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  const out = send(room, host.conn, "state", { state: "playing", timeMs: 5000.4, at: now - 100 }, now);
  const push = out.find((o) => o.msg.type === "state");
  assert.equal(push.to, "all");
  assert.deepEqual(room.playback, { state: "playing", timeMs: 5000, at: now - 100 });

  send(room, host.conn, "state", { state: "paused", timeMs: 1, at: now - 60_000 }, now);
  assert.equal(room.playback.at, now, "stale timestamps fall back to server time");

  assert.equal(replyOf(send(room, host.conn, "state", { state: "rewinding", timeMs: 1 }, now)).error, "bad state");
  assert.equal(replyOf(send(room, host.conn, "state", { state: "paused", timeMs: -1 }, now)).error, "bad time");
});

test("control lock limits playback to the host", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO, controlLock: true });
  const guest = hello(room, now, "join", { name: "Bob" });
  assert.equal(replyOf(send(room, guest.conn, "state", { state: "playing", timeMs: 0, at: now }, now)).error, "locked");
  assert.equal(replyOf(send(room, guest.conn, "video", VIDEO, now)).error, "locked");
  assert.equal(replyOf(send(room, guest.conn, "lock", { on: false }, now)).error, "host only");
  send(room, host.conn, "lock", { on: false }, now);
  assert.equal(replyOf(send(room, guest.conn, "state", { state: "playing", timeMs: 0, at: now }, now)).error, undefined);
});

test("video change resets playback", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  send(room, host.conn, "state", { state: "playing", timeMs: 90_000, at: now }, now);
  const out = send(room, host.conn, "video", { url: "https://example.com/watch/2", title: "Episode 2" }, now + 5);
  assert.ok(out.some((o) => o.msg.type === "video" && o.msg.data.title === "Episode 2"));
  assert.deepEqual(room.playback, { state: "paused", timeMs: 0, at: now + 5 });
});

test("chat is sanitised and history is capped", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  const out = send(room, host.conn, "chat", { text: "  hi\nthere\u0007 " }, now);
  assert.equal(out.find((o) => o.msg.type === "chat").msg.data.text, "hi there");
  assert.equal(replyOf(send(room, host.conn, "chat", { text: "x".repeat(501) }, now)).error, "bad text");
  for (let i = 0; i < LIMITS.keptMessages + 5; i++) send(room, host.conn, "chat", { text: "m" + i }, now + 10_000 + i * 1000);
  assert.equal(room.messages.length, LIMITS.keptMessages);
});

test("reactions must come from the fixed list", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  assert.equal(replyOf(send(room, host.conn, "react", { emoji: "🔥" }, now)).error, undefined);
  assert.equal(replyOf(send(room, host.conn, "react", { emoji: "<b>" }, now)).error, "bad emoji");
});

test("presence flags broadcast only on change", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  assert.ok(send(room, host.conn, "buffering", { on: true }, now).some((o) => o.msg.type === "users"));
  assert.ok(!send(room, host.conn, "buffering", { on: true }, now).some((o) => o.msg.type === "users"));
});

test("resume identity with token, reject wrong token", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  const { userId, token } = host.reply.data;
  handleClose(room, host.conn, now + 1);

  const bad = hello(room, now + 2, "join", { userId, token: "nope" });
  assert.notEqual(bad.reply.data.userId, userId);

  const good = hello(room, now + 3, "join", { userId, token });
  assert.equal(good.reply.data.userId, userId);
});

test("host leaving hands the role to the longest-connected member", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  const bob = hello(room, now + 1, "join", { name: "Bob" });
  hello(room, now + 2, "join", { name: "Cy" });
  const { out } = handleClose(room, host.conn, now + 3);
  assert.equal(room.hostId, bob.reply.data.userId);
  assert.ok(out.some((o) => o.msg.type === "notice" && o.msg.data.kind === "host" && o.msg.data.name === "Bob"));
});

test("two tabs of one user count once", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  const { userId, token } = host.reply.data;
  const second = hello(room, now, "join", { userId, token });
  assert.equal(second.reply.data.room.users.length, 1);
  assert.deepEqual(handleClose(room, second.conn, now).out, []);
  assert.ok(!isEmpty(room));
  handleClose(room, host.conn, now);
  assert.ok(isEmpty(room));
  assert.equal(room.emptySince, now);
});

test("rate limit drops floods", () => {
  const { room, now } = setup();
  const host = hello(room, now, "create", { video: VIDEO });
  let replies = 0;
  for (let i = 0; i < 200; i++) replies += send(room, host.conn, "time", {}, now, i).length;
  assert.ok(replies <= LIMITS.rateBurst, `got ${replies} replies`);
});

test("oversized frames close the connection", () => {
  const { room, now } = setup();
  const conn = newConnection("c1", now);
  const res = handleMessage(room, conn, "x".repeat(LIMITS.maxFrameBytes + 1), now);
  assert.equal(res.close, true);
});

test("party full", () => {
  const { room, now } = setup();
  hello(room, now, "create", { video: VIDEO });
  for (let i = 1; i < LIMITS.maxMembers; i++) hello(room, now, "join", { name: "u" + i });
  assert.equal(hello(room, now, "join").reply.error, "party full");
});

test("create can resume a known playback position", () => {
  const { room, now } = setup();
  hello(room, now, "create", { video: VIDEO, playback: { state: "playing", timeMs: 61_000.7 } });
  assert.deepEqual(room.playback, { state: "playing", timeMs: 61_001, at: now });
});

test("create ignores a malformed playback position", () => {
  const { room, now } = setup();
  hello(room, now, "create", { video: VIDEO, playback: { state: "zoom", timeMs: -5 } });
  assert.deepEqual(room.playback, { state: "paused", timeMs: 0, at: now });
});

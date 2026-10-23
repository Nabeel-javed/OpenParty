import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// extension/shared/util.js is a plain script; evaluate it in a sandbox.
const sandbox = { crypto, URL, URLSearchParams };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL("../extension/shared/util.js", import.meta.url), "utf8"), sandbox);
const U = sandbox.OPU;

test("party ids match the server alphabet", () => {
  for (let i = 0; i < 50; i++) assert.ok(U.isPartyId(U.newPartyId()));
});

test("parseInvite accepts every invite form", () => {
  assert.deepEqual({ ...U.parseInvite("k3m9q2x7pa") }, { partyId: "k3m9q2x7pa", host: null });
  assert.deepEqual({ ...U.parseInvite(" K3M9Q2X7PA@party.example ") }, { partyId: "k3m9q2x7pa", host: "party.example" });
  assert.deepEqual({ ...U.parseInvite("https://www.netflix.com/watch/1#openparty=k3m9q2x7pa@party.example") }, {
    partyId: "k3m9q2x7pa",
    host: "party.example",
  });
  assert.deepEqual({ ...U.parseInvite("https://party.example/j/k3m9q2x7pa") }, {
    partyId: "k3m9q2x7pa",
    host: "party.example",
    scheme: "https",
  });
  assert.equal(U.parseInvite("hello world"), null);
  assert.equal(U.parseInvite("k3m9q2x7p1"), null, "1 is not in the alphabet");
});

test("serverForInvite picks http for localhost and https elsewhere", () => {
  const settings = { serverUrl: "https://default.example" };
  assert.equal(U.serverForInvite({ host: null }, settings), "https://default.example");
  assert.equal(U.serverForInvite({ host: "localhost:8787" }, settings), "http://localhost:8787");
  assert.equal(U.serverForInvite({ host: "party.example" }, settings), "https://party.example");
});

test("videoKey ignores tracking noise but keeps identifying params", () => {
  assert.equal(
    U.videoKey("https://www.netflix.com/watch/80100172?trackId=14170286&tctx=1"),
    "https://www.netflix.com/watch/80100172",
  );
  assert.notEqual(U.videoKey("https://www.youtube.com/watch?v=aaa"), U.videoKey("https://www.youtube.com/watch?v=bbb"));
  assert.equal(U.videoKey("https://www.youtube.com/watch?v=aaa&t=42s&si=x"), U.videoKey("https://www.youtube.com/watch?v=aaa"));
  assert.equal(U.videoKey("https://example.com/show/"), U.videoKey("https://example.com/show#frag"));
});

test("ws and invite urls", () => {
  assert.equal(U.wsUrl("https://party.example", "k3m9q2x7pa"), "wss://party.example/ws/k3m9q2x7pa");
  assert.equal(U.wsUrl("http://localhost:8787", "k3m9q2x7pa"), "ws://localhost:8787/ws/k3m9q2x7pa");
  assert.equal(U.inviteUrl("https://party.example", "k3m9q2x7pa"), "https://party.example/j/k3m9q2x7pa");
  assert.equal(U.originPattern("https://www.netflix.com/watch/1"), "https://www.netflix.com/*");
  assert.equal(U.originPattern("chrome://extensions"), null);
  assert.equal(U.normalizeServerUrl("https://party.example/some/path"), "https://party.example");
  assert.equal(U.normalizeServerUrl("ftp://x"), null);
});

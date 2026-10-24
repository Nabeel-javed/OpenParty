import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteLink, invitePage } from "../server/core/pages.js";

test("invite link adds the party fragment", () => {
  const link = inviteLink({ url: "https://example.com/watch/1?x=1" }, "k3m9q2x7pa", "party.example");
  assert.equal(link, "https://example.com/watch/1?x=1#openparty=k3m9q2x7pa@party.example");
});

test("invite link keeps an existing fragment", () => {
  const link = inviteLink({ url: "https://example.com/#/watch/1" }, "k3m9q2x7pa", "party.example");
  assert.equal(link, "https://example.com/#/watch/1");
});

test("invite page escapes titles", () => {
  const room = { id: "k3m9q2x7pa", hostId: "u_1", video: { url: "https://example.com/v", title: '<script>alert("x")</script>' } };
  const html = invitePage(room, "party.example");
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("invite page for a missing party", () => {
  assert.match(invitePage(null, "party.example"), /Party not found/);
});

test("invite page carries escaped party data for the extension", () => {
  const room = { id: "k3m9q2x7pa", hostId: "u_1", video: { url: 'https://example.com/v?a=1&b="2"', title: 'A "quoted" <title>' } };
  const html = invitePage(room, "party.example");
  assert.ok(html.includes('id="openparty-invite"'));
  assert.ok(html.includes('data-party-id="k3m9q2x7pa"'));
  assert.ok(html.includes('data-video-url="https://example.com/v?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(html.includes('data-video-title="A &quot;quoted&quot; &lt;title&gt;"'));
});

// Minimal protocol client for end-to-end tests (uses Node's built-in WebSocket).

export async function connect(baseUrl, partyId) {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/${partyId}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("connect failed")), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const inbox = [];
  const waiters = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "reply" && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
      return;
    }
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });

  return {
    ws,
    request(type, data = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ type, id, data }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve });
        setTimeout(() => pending.has(id) && reject(new Error(`no reply to ${type}`)), 3000);
      });
    },
    send(type, data = {}) {
      ws.send(JSON.stringify({ type, data }));
    },
    next(type, predicate = () => true, timeoutMs = 3000) {
      const match = (m) => m.type === type && predicate(m.data);
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) {
            waiters.splice(j, 1);
            reject(new Error(`timed out waiting for ${type}`));
          }
        }, timeoutMs);
      });
    },
    close() {
      ws.close();
    },
  };
}

// Scenario shared by the Node and Worker end-to-end tests.
export async function runScenario(t, baseUrl, assert, partyId) {
  const video = { url: "https://example.com/watch/1", title: "Pilot", durationMs: 1_800_000 };

  const host = await connect(baseUrl, partyId);
  const created = await host.request("hello", { action: "create", user: { name: "Ann", avatar: "🐱" }, video });
  assert.equal(created.error, undefined);
  assert.equal(created.data.partyId, partyId);

  const guest = await connect(baseUrl, partyId);
  const joined = await guest.request("hello", { action: "join", user: { name: "Bob", avatar: "🐶" } });
  assert.equal(joined.error, undefined);
  assert.equal(joined.data.room.video.title, "Pilot");
  await host.next("notice", (d) => d.kind === "join" && d.name === "Bob");

  const time = await guest.request("time");
  assert.ok(Math.abs(time.data.now - Date.now()) < 5000);

  await host.request("state", { state: "playing", timeMs: 42_000, at: time.data.now });
  const state = await guest.next("state", (d) => d.state === "playing");
  assert.equal(state.data.timeMs, 42_000);

  await guest.request("chat", { text: "hello <b>there</b>" });
  const chat = await host.next("chat");
  assert.equal(chat.data.text, "hello <b>there</b>");
  assert.equal(chat.data.name, "Bob");

  const page = await fetch(`${baseUrl}/j/${partyId}`).then((r) => r.text());
  assert.ok(page.includes("Pilot"));
  assert.ok(page.includes(`#openparty=${partyId}@`));

  guest.close();
  await host.next("notice", (d) => d.kind === "leave" && d.name === "Bob");
  host.close();
}

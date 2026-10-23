// One WebSocket connection to a party, with reconnects and clock estimation.
// Loaded into the service worker with importScripts.
(() => {
  const PING_MS = 20_000; // also keeps the MV3 service worker alive
  const CLOCK_SAMPLE_MS = 15_000;
  const CLOCK_WINDOW = 5;
  const REQUEST_TIMEOUT_MS = 8_000;
  const MAX_BACKOFF_MS = 30_000;
  // Exact text so the Cloudflare server can answer without waking up.
  const PING_FRAME = '{"type":"ping"}';

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  class PartySocket {
    // hooks: hello() -> Promise<payload>, welcome(data), push(type, data),
    //        fatal(error), status(text), clock(offset)
    constructor(serverUrl, partyId, hooks) {
      this.url = OPU.wsUrl(serverUrl, partyId);
      this.hooks = hooks;
      this.ws = null;
      this.closed = false;
      this.attempt = 0;
      this.nextId = 1;
      this.pending = new Map();
      this.samples = [];
      this.offset = 0;
      this.timers = [];
      this.welcomed = false;
    }

    connect() {
      if (this.closed) return;
      this.hooks.status(this.welcomed ? "reconnecting" : "connecting");
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.hooks.fatal("Invalid server address.");
        return;
      }
      this.ws = ws;
      ws.onopen = () => this.onOpen();
      ws.onmessage = (event) => this.onMessage(event.data);
      ws.onclose = () => this.onClose(ws);
      ws.onerror = () => {}; // onclose follows
    }

    async onOpen() {
      const reply = await this.request("hello", await this.hooks.hello());
      if (reply.error) {
        this.close();
        this.hooks.fatal(reply.error);
        return;
      }
      this.attempt = 0;
      this.welcomed = true;
      this.hooks.status("connected");
      this.hooks.welcome(reply.data);
      this.startTimers();
    }

    onMessage(text) {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "reply") {
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          clearTimeout(waiter.timer);
          waiter.resolve(msg.error ? { error: msg.error } : { data: msg.data || {} });
        }
        return;
      }
      if (msg.type === "pong") return;
      this.hooks.push(msg.type, msg.data || {});
    }

    onClose(ws) {
      if (ws !== this.ws) return;
      this.stopTimers();
      for (const [, waiter] of this.pending) {
        clearTimeout(waiter.timer);
        waiter.resolve({ error: "disconnected" });
      }
      this.pending.clear();
      if (this.closed) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
      this.hooks.status("reconnecting");
      this.timers.push(setTimeout(() => this.connect(), delay));
    }

    request(type, data = {}) {
      return new Promise((resolve) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          resolve({ error: "disconnected" });
          return;
        }
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve({ error: "timeout" });
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, timer });
        this.ws.send(JSON.stringify({ type, id, data }));
      });
    }

    send(type, data = {}) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data }));
    }

    startTimers() {
      this.stopTimers();
      this.timers.push(
        setInterval(() => this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.send(PING_FRAME), PING_MS),
      );
      // A quick burst of clock samples, then one every 15 s.
      for (let i = 0; i < CLOCK_WINDOW; i++) this.timers.push(setTimeout(() => this.sampleClock(), i * 400));
      this.timers.push(setInterval(() => this.sampleClock(), CLOCK_SAMPLE_MS));
    }

    stopTimers() {
      for (const t of this.timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      this.timers = [];
    }

    async sampleClock() {
      const sent = Date.now();
      const reply = await this.request("time");
      const received = Date.now();
      if (reply.error || typeof reply.data.now !== "number") return;
      const rtt = received - sent;
      this.samples.push(reply.data.now + rtt / 2 - received);
      if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
      const offset = Math.round(median(this.samples));
      if (Math.abs(offset - this.offset) >= 15 || this.samples.length === 1) {
        this.offset = offset;
        this.hooks.clock(offset);
      }
    }

    close() {
      this.closed = true;
      this.stopTimers();
      if (this.ws) {
        try {
          this.ws.close(1000, "leave");
        } catch {
          // already closed
        }
      }
    }
  }

  globalThis.PartySocket = PartySocket;
})();

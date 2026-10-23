// Keeps one local player in step with the party.
//
// Party time = timeMs + (playing ? serverNow - at : 0), where serverNow is the
// local clock plus the offset estimated by the service worker.
//  * Local play/pause/seek events are broadcast (unless control is locked).
//  * Remote changes are applied when we're more than REMOTE_TOLERANCE_MS off.
//  * A 1 s tick corrects drift beyond DRIFT_TOLERANCE_MS.
// Changes we make ourselves are not echoed: they bring the player in line with
// the party, so the comparison in onLocalChange finds nothing to broadcast,
// and events fired while `applying` are ignored outright.
(() => {
  const OP = globalThis.OP;
  if (OP.SyncEngine) return;

  const SEEK_DETECT_MS = 1000;
  const REMOTE_TOLERANCE_MS = 1000;
  const DRIFT_TOLERANCE_MS = 2500;
  const END_GUARD_MS = 1500; // don't chase a party position past the end of our video
  const TICK_MS = 1000;
  const SETTLE_MS = 400;
  const BUFFERING_DEBOUNCE_MS = 700;

  class SyncEngine {
    // hooks.send(op, data) -> Promise<reply>; hooks.notify(kind)
    constructor(adapter, hooks, options = {}) {
      this.adapter = adapter;
      this.hooks = hooks;
      this.tickMs = options.tickMs || TICK_MS;
      this.settleMs = options.settleMs ?? SETTLE_MS;
      this.playback = { state: "paused", timeMs: 0, at: 0 };
      this.offset = 0;
      this.locked = false;
      this.isHost = false;
      this.me = null;
      this.applying = 0;
      this.inflight = []; // our broadcasts the server hasn't echoed yet
      this.flags = { buffering: false, ads: false };
      this.timer = null;
      this.bufferTimer = null;
    }

    start() {
      this.adapter.attach((type) => this.onMediaEvent(type));
      this.timer = setInterval(() => this.tick(), this.tickMs);
    }

    stop() {
      this.adapter.detach();
      clearInterval(this.timer);
      clearTimeout(this.bufferTimer);
      if (this.flags.buffering) this.hooks.send("buffering", { on: false });
      if (this.flags.ads) this.hooks.send("ads", { on: false });
    }

    configure(cfg) {
      if (typeof cfg.offset === "number") this.offset = cfg.offset;
      if (typeof cfg.locked === "boolean") this.locked = cfg.locked;
      if (typeof cfg.isHost === "boolean") this.isHost = cfg.isHost;
      if (cfg.me) this.me = cfg.me;
      if (cfg.playback) {
        this.playback = { ...cfg.playback };
        this.inflight = [];
      }
    }

    serverNow() {
      return Date.now() + this.offset;
    }

    expectedMs() {
      const p = this.playback;
      return Math.max(0, p.timeMs + (p.state === "playing" ? this.serverNow() - p.at : 0));
    }

    canControl() {
      return !this.locked || this.isHost;
    }

    suspended() {
      return !!(this.adapter.backgroundSuspended && this.adapter.backgroundSuspended());
    }

    onMediaEvent(type) {
      if (type === "waiting") this.setBuffering(true);
      else if (type === "playing" || type === "canplay" || type === "pause") this.setBuffering(false);
      if (this.applying > 0 || this.adapter.inAd() || this.suspended()) return;
      if (type === "play" || type === "pause" || type === "seeked" || type === "ended") this.onLocalChange(type);
    }

    onLocalChange(type) {
      const paused = this.adapter.paused();
      const timeMs = this.adapter.timeMs();
      const stateChanged = paused !== (this.playback.state === "paused");
      const jumped = type === "seeked" && !this.adapter.live() && Math.abs(timeMs - this.expectedMs()) > SEEK_DETECT_MS;
      if (!stateChanged && !jumped) return;
      if (!this.canControl()) {
        this.hooks.notify("locked");
        this.apply("revert");
        return;
      }
      this.broadcast(paused ? "paused" : "playing", timeMs);
    }

    // Make our current local state the party state (party start, host changed video).
    adopt() {
      if (this.adapter.inAd() || !this.canControl()) return;
      this.broadcast(this.adapter.paused() ? "paused" : "playing", this.adapter.timeMs());
    }

    async broadcast(state, timeMs) {
      const msg = { state, timeMs: Math.round(timeMs), at: Math.round(this.serverNow()) };
      this.playback = { ...msg };
      this.inflight.push(msg);
      const reply = await this.hooks.send("local-state", msg);
      if (reply && reply.error) {
        this.inflight = this.inflight.filter((m) => m !== msg);
        if (reply.error === "locked") {
          this.hooks.notify("locked");
          this.hooks.send("resync", {});
        }
      }
    }

    onRemote(playback, by) {
      if (by && by === this.me) {
        const i = this.inflight.findIndex((m) => m.state === playback.state && m.timeMs === playback.timeMs);
        if (i >= 0) this.inflight.splice(0, i + 1);
        if (this.inflight.length > 0) return; // a newer local change is still on its way
        this.playback = { ...playback };
        return;
      }
      this.inflight = [];
      this.playback = { ...playback };
      this.apply("remote");
    }

    tick() {
      const ad = this.adapter.inAd();
      if (ad !== this.flags.ads) {
        this.flags.ads = ad;
        this.hooks.send("ads", { on: ad });
      }
      if (!ad && this.applying === 0) this.apply("drift");
    }

    async apply(reason) {
      if (this.applying > 0 || this.adapter.inAd() || this.suspended()) return;
      const wantPaused = this.playback.state === "paused";
      const target = this.expectedMs();
      const duration = this.adapter.durationMs();
      const pastEnd = duration > 0 && target > duration - END_GUARD_MS;
      const tolerance = reason === "drift" ? DRIFT_TOLERANCE_MS : REMOTE_TOLERANCE_MS;
      const needSeek = !this.adapter.live() && !pastEnd && Math.abs(this.adapter.timeMs() - target) > tolerance;
      const needState = this.adapter.paused() !== wantPaused;
      if (!needSeek && !needState) return;

      this.applying++;
      try {
        if (needSeek) {
          await this.adapter.seek(this.expectedMs());
          await this.waitFor(() => !this.adapter.seeking(), 4000);
        }
        if (wantPaused && !this.adapter.paused()) {
          await this.adapter.pause();
        } else if (!wantPaused && this.adapter.paused()) {
          const result = await this.adapter.play();
          if (result === "blocked") this.hooks.notify("blocked");
        }
        if (this.settleMs) await OP.sleep(this.settleMs);
      } finally {
        this.applying--;
      }
    }

    setBuffering(on) {
      clearTimeout(this.bufferTimer);
      if (on) {
        this.bufferTimer = setTimeout(() => {
          if (!this.flags.buffering) {
            this.flags.buffering = true;
            this.hooks.send("buffering", { on: true });
          }
        }, BUFFERING_DEBOUNCE_MS);
      } else if (this.flags.buffering) {
        this.flags.buffering = false;
        this.hooks.send("buffering", { on: false });
      }
    }

    async waitFor(predicate, timeoutMs) {
      const start = Date.now();
      while (!predicate() && Date.now() - start < timeoutMs) await OP.sleep(50);
    }
  }

  OP.SyncEngine = SyncEngine;
})();

// Default adapter: drives a plain HTMLVideoElement. Works for most sites.
(() => {
  const OP = globalThis.OP;
  if (OP.Html5Adapter) return;

  const EVENTS = ["play", "pause", "seeked", "waiting", "playing", "canplay", "ended"];

  class Html5Adapter {
    constructor(video, site) {
      this.video = video;
      this.site = site;
      this.handlers = [];
    }

    attach(listener) {
      for (const type of EVENTS) {
        const handler = () => listener(type);
        this.video.addEventListener(type, handler);
        this.handlers.push([type, handler]);
      }
    }

    detach() {
      for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
      this.handlers = [];
    }

    timeMs() {
      return this.video.currentTime * 1000;
    }

    durationMs() {
      const d = this.video.duration;
      return Number.isFinite(d) ? d * 1000 : 0;
    }

    paused() {
      return this.video.paused;
    }

    seeking() {
      return this.video.seeking;
    }

    // Live streams report an infinite duration; they sync play/pause only.
    live() {
      return this.video.duration === Infinity;
    }

    inAd() {
      return OP.adVisible(this.site.ad);
    }

    // Chromium pauses muted or audio-less videos in hidden tabs by itself.
    // Those pauses aren't the user's, so they must not pause the party.
    backgroundSuspended() {
      if (!document.hidden) return false;
      return this.video.muted || this.video.webkitAudioDecodedByteCount === 0;
    }

    async play() {
      try {
        await this.video.play();
        return "ok";
      } catch (e) {
        return e && e.name === "NotAllowedError" ? "blocked" : "failed";
      }
    }

    async pause() {
      this.video.pause();
    }

    async seek(ms) {
      this.video.currentTime = Math.max(0, ms) / 1000;
    }
  }

  OP.Html5Adapter = Html5Adapter;
  OP.adapters = { html5: Html5Adapter };
})();

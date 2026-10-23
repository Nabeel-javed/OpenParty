// Netflix shows a playback error when currentTime is changed directly, so play,
// pause and seek go through Netflix's own player via page/netflix.js (injected
// into the page world by the service worker). Reading state still uses <video>.
(() => {
  const OP = globalThis.OP;
  if (OP.adapters.netflix) return;

  class NetflixAdapter extends OP.Html5Adapter {
    command(cmd, ms) {
      window.postMessage({ openparty: "netflix", cmd, ms }, location.origin);
    }

    async play() {
      this.command("play");
      await OP.sleep(800);
      // Still paused: the browser may be blocking autoplay; let the base class report it.
      return this.video.paused ? super.play() : "ok";
    }

    async pause() {
      this.command("pause");
    }

    async seek(ms) {
      this.command("seek", Math.max(0, Math.round(ms)));
    }
  }

  OP.adapters.netflix = NetflixAdapter;
})();

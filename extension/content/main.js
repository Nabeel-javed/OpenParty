// Content-script entry point, injected into every frame of a party tab.
// Each frame reports its best video; the service worker picks one frame to
// run the sync engine. The top frame also hosts the party panel and watches
// for the host moving to another video.
(() => {
  const OP = globalThis.OP;
  if (OP.boot) {
    OP.boot(); // re-injected after joining again: just re-announce
    return;
  }

  const site = OP.siteFor(location.hostname);
  const state = {
    inParty: false,
    engine: null,
    lastScore: -1,
    scanTimer: null,
    urlTimer: null,
    lastKey: null,
    unblock: null,
    frameObserver: null,
  };

  const findVideo = () => OP.bestVideo(site.video);

  function report(force) {
    if (!state.inParty) return;
    const video = findVideo();
    const score = video ? OP.videoScore(video) : 0;
    const moved = Math.abs(score - state.lastScore) > Math.max(5000, state.lastScore * 0.15);
    if (force || moved || (score === 0) !== (state.lastScore === 0)) {
      state.lastScore = score;
      OP.send({ op: "frame-report", score });
    }
    // Some players swap their <video> element (quality change, next episode).
    if (state.engine && video && state.engine.adapter.video !== video) restartEngine(video);
    if (OP.isTop) OP.ui.ensureAttached();
  }

  function startEngine(video, cfg) {
    const Adapter = OP.adapters[site.adapter] || OP.Html5Adapter;
    const engine = new OP.SyncEngine(new Adapter(video, site), {
      send: (op, data) => OP.send({ op, ...data }),
      notify: (kind) => (kind === "blocked" ? showUnblock() : OP.send({ op: "local-notice", kind })),
    });
    engine.configure(cfg);
    engine.start();
    state.engine = engine;
    if (cfg.adopt) engine.adopt();
    else engine.apply("remote");
  }

  function restartEngine(video) {
    const e = state.engine;
    const cfg = { playback: e.playback, offset: e.offset, locked: e.locked, isHost: e.isHost, me: e.me };
    stopEngine();
    startEngine(video, cfg);
  }

  function stopEngine() {
    if (state.engine) {
      state.engine.stop();
      state.engine = null;
    }
  }

  function onActivate(msg) {
    const video = findVideo();
    if (!video) {
      OP.send({ op: "frame-report", score: 0 });
      return;
    }
    if (!state.engine) return startEngine(video, msg);
    state.engine.configure(msg);
    if (msg.adopt) state.engine.adopt();
    else state.engine.apply("remote");
  }

  // Browsers refuse play() until the user has interacted with the page.
  function showUnblock() {
    if (state.unblock) return;
    const host = document.createElement("openparty-unblock");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `button { position: fixed; inset: 0; margin: auto; width: 260px; height: 64px; z-index: 2147483647;
      border: 0; border-radius: 14px; background: #5b4bff; color: #fff; font: 600 16px system-ui, sans-serif;
      box-shadow: 0 8px 30px #000a; cursor: pointer; }`;
    const button = document.createElement("button");
    button.textContent = "▶ Click to join playback";
    button.addEventListener("click", () => {
      host.remove();
      state.unblock = null;
      if (state.engine) state.engine.apply("remote");
    });
    shadow.append(style, button);
    (document.fullscreenElement || document.documentElement).appendChild(host);
    state.unblock = host;
  }

  // Top frame: announce when the page moves to another video (next episode).
  function watchUrl() {
    state.lastKey = OPU.videoKey(location.href);
    state.urlTimer = setInterval(async () => {
      const key = OPU.videoKey(location.href);
      if (key === state.lastKey) return;
      state.lastKey = key;
      // Only pages that end up showing a video count (not menus or browse pages).
      for (let i = 0; i < 10; i++) {
        await OP.sleep(1000);
        if (!state.inParty || OPU.videoKey(location.href) !== key) return;
        const res = await OP.send({ op: "has-video" });
        if (res && res.hasVideo) {
          const video = findVideo();
          const durationMs = video && Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
          OP.send({ op: "video-changed", url: location.href, title: document.title, durationMs });
          return;
        }
      }
    }, 1000);
  }

  // Players often arrive later, in a new iframe or one that navigates (single-page
  // sites add theirs when you press Play): have OpenParty set up in those frames too.
  function watchFrames() {
    let timer = null;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => state.inParty && OP.send({ op: "frames-changed" }), 500);
    };
    const tracked = new WeakSet();
    const track = () => {
      for (const frame of document.querySelectorAll("iframe, frame")) {
        if (tracked.has(frame)) continue;
        tracked.add(frame);
        frame.addEventListener("load", changed); // also fires when the frame navigates
      }
    };
    track();
    state.frameObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.localName === "iframe" || node.querySelector("iframe"))) {
            track();
            changed();
            return;
          }
        }
      }
    });
    state.frameObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function ensureLoops() {
    if (!state.scanTimer) state.scanTimer = setInterval(() => report(false), 2000);
    if (OP.isTop && !state.urlTimer) watchUrl();
    if (!state.frameObserver) watchFrames();
  }

  function teardown(message) {
    state.inParty = false;
    stopEngine();
    clearInterval(state.scanTimer);
    clearInterval(state.urlTimer);
    state.scanTimer = state.urlTimer = null;
    if (state.frameObserver) state.frameObserver.disconnect();
    state.frameObserver = null;
    state.lastScore = -1;
    if (state.unblock) state.unblock.remove();
    state.unblock = null;
    if (OP.isTop) OP.ui.unmount(message);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    sendResponse({ ok: true });
    switch (msg && msg.op) {
      case "report":
        state.inParty = true;
        ensureLoops();
        report(true);
        break;
      case "activate":
        onActivate(msg);
        break;
      case "deactivate":
        stopEngine();
        break;
      case "remote-state":
        if (state.engine) state.engine.onRemote(msg.playback, msg.by);
        break;
      case "clock":
        if (state.engine) state.engine.configure({ offset: msg.offset });
        break;
      case "role":
        if (state.engine) state.engine.configure({ isHost: msg.isHost, locked: msg.locked });
        break;
      case "adopt":
        if (state.engine) state.engine.adopt();
        break;
      case "left":
        teardown(msg.message || "You left the party.");
        break;
      case "room":
      case "ui":
      case "show-panel":
        if (OP.isTop) {
          state.inParty = true;
          ensureLoops();
          OP.ui.handle(msg);
        }
        break;
    }
  });

  addEventListener("pagehide", () => {
    if (state.inParty) OP.send({ op: "frame-gone" });
  });

  async function boot() {
    const res = await OP.send({ op: "content-hello" });
    if (!res || !res.inParty) return;
    state.inParty = true;
    if (OP.isTop && res.room) OP.ui.handle({ op: "room", room: res.room });
    ensureLoops();
    report(true);
  }

  OP.boot = boot;
  boot();
})();

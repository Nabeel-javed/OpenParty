// Namespace and small helpers for the content scripts. Every content file is
// an IIFE that attaches to globalThis.OP so re-injection never redeclares.
(() => {
  const OP = (globalThis.OP = globalThis.OP || {});
  if (OP.nsLoaded) return;
  OP.nsLoaded = true;

  OP.isTop = window === window.top;
  OP.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  OP.send = (msg) =>
    chrome.runtime.sendMessage(msg).catch(() => ({ error: "extension unavailable" }));

  // Every <video>, including ones inside open shadow roots (custom players).
  OP.findVideos = (root = document) => {
    const videos = [...root.querySelectorAll("video")];
    const visit = (node, depth) => {
      if (depth > 6) return;
      for (const el of node.querySelectorAll("*")) {
        if (!el.shadowRoot) continue;
        videos.push(...el.shadowRoot.querySelectorAll("video"));
        visit(el.shadowRoot, depth + 1);
      }
    };
    if (videos.length === 0) visit(root, 0);
    return videos;
  };

  // Bigger, loaded and playing videos win. Zero means "not a candidate".
  OP.videoScore = (video) => {
    if (!video || !video.isConnected) return 0;
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < 160 * 90) return 0;
    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return 0;
    let score = area;
    if (video.readyState > 0 && video.duration > 0) score *= 2;
    if (!video.paused) score *= 1.5;
    return Math.round(score);
  };

  OP.bestVideo = (selector) => {
    if (selector) {
      const preferred = document.querySelector(selector);
      if (preferred && OP.videoScore(preferred) > 0) return preferred;
    }
    let best = null;
    let bestScore = 0;
    for (const video of OP.findVideos()) {
      const score = OP.videoScore(video);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    return best;
  };

  OP.formatTime = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  };
})();

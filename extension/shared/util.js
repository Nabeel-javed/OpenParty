// Helpers shared by the service worker (importScripts), the popup/options
// pages (<script>) and content scripts (injected file list). Plain script, no
// modules, so every context can load it without a build step.
(() => {
  if (globalThis.OPU) return;

  const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
  const PARTY_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

  // Change this once the public server is deployed.
  const DEFAULT_SERVER_URL = "http://localhost:8787";

  const DEFAULT_SETTINGS = {
    serverUrl: DEFAULT_SERVER_URL,
    name: "",
    avatar: "🍿",
  };

  const AVATARS = ["🍿", "🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🐙", "👽", "🤖", "🎃", "🌵"];
  const REACTIONS = ["👍", "😂", "😮", "😢", "❤️", "🔥", "👏", "🎉"];

  // Query parameters that never identify a video; dropped when comparing URLs.
  const NOISE_PARAMS = /^(utm_.*|trackId|tctx|t|si|feature|pp|ref|ref_|fbclid|gclid)$/i;

  function newPartyId() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let id = "";
    for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
    return id;
  }

  function isPartyId(id) {
    return typeof id === "string" && PARTY_ID_RE.test(id);
  }

  // Accepts a bare code, "code@host", a video URL with #openparty=…,
  // or an invite page URL (https://host/j/code).
  function parseInvite(text) {
    if (typeof text !== "string") return null;
    const input = text.trim();
    const fragment = input.match(/openparty=([23456789a-z]{10})(?:@([a-z0-9.:\-\[\]]+))?/i);
    if (fragment) return { partyId: fragment[1].toLowerCase(), host: fragment[2] || null };
    const invitePage = input.match(/^(https?):\/\/([^/]+)\/j\/([23456789a-z]{10})\b/i);
    if (invitePage) {
      return { partyId: invitePage[3].toLowerCase(), host: invitePage[2], scheme: invitePage[1].toLowerCase() };
    }
    const bare = input.match(/^([23456789a-z]{10})(?:@([a-z0-9.:\-\[\]]+))?$/i);
    if (bare) return { partyId: bare[1].toLowerCase(), host: bare[2] || null };
    return null;
  }

  function isLocalHost(host) {
    return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  }

  // Server base URL for an invite that names a host, else the configured one.
  function serverForInvite(invite, settings) {
    if (!invite.host) return settings.serverUrl;
    const scheme = invite.scheme || (isLocalHost(invite.host) ? "http" : "https");
    return `${scheme}://${invite.host}`;
  }

  function normalizeServerUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch {
      return null;
    }
  }

  function wsUrl(serverUrl, partyId) {
    return `${serverUrl.replace(/^http/, "ws")}/ws/${partyId}`;
  }

  function inviteUrl(serverUrl, partyId) {
    return `${serverUrl}/j/${partyId}`;
  }

  // Identity of "the video" behind a URL: origin + path + meaningful query.
  function videoKey(href) {
    try {
      const u = new URL(href);
      const params = [...u.searchParams].filter(([k]) => !NOISE_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
      const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
      return u.origin + u.pathname.replace(/\/+$/, "") + query;
    } catch {
      return href;
    }
  }

  function originPattern(href) {
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return `${u.protocol}//${u.hostname}/*`;
    } catch {
      return null;
    }
  }

  // Site access is asked for once, for all sites, the first time a party is
  // started or joined (the prompt only appears if it isn't granted yet).
  // Extension pages only; must run synchronously inside a click handler.
  const ALL_SITES = ["<all_urls>"];

  function requestAllSites() {
    return chrome.permissions.request({ origins: ALL_SITES }).catch(() => false);
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    if (!settings.name) {
      settings.name = "Guest " + String(Math.floor(1000 + Math.random() * 9000));
      await chrome.storage.local.set({ name: settings.name });
    }
    return settings;
  }

  globalThis.OPU = {
    DEFAULT_SERVER_URL,
    DEFAULT_SETTINGS,
    AVATARS,
    REACTIONS,
    newPartyId,
    isPartyId,
    parseInvite,
    serverForInvite,
    normalizeServerUrl,
    wsUrl,
    inviteUrl,
    videoKey,
    originPattern,
    ALL_SITES,
    requestAllSites,
    getSettings,
  };
})();

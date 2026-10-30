// OpenParty service worker. One party session per tab: it owns the server
// socket and routes messages between the server, the tab's frames (the frame
// with the video runs the sync engine; the top frame shows the party panel)
// and the popup.

importScripts("shared/util.js", "background/party-socket.js");

const CONTENT_FILES = [
  "shared/util.js",
  "content/ns.js",
  "content/sites.js",
  "content/adapters/html5.js",
  "content/adapters/netflix.js",
  "content/sync.js",
  "content/ui.js",
  "content/main.js",
];

// Page-world helpers for players that must be driven through their own API.
const PAGE_SCRIPTS = [{ host: /(^|\.)netflix\.com$/, file: "page/netflix.js" }];

const CONNECT_TIMEOUT_MS = 10_000;
const FRAME_SWITCH_MARGIN = 1.2; // a new frame must score 20% higher to take over
const STORE_PREFIX = "party:";
const INVITE_PREFIX = "invite:";

const ERRORS = {
  "no such party": "That party doesn't exist or has ended.",
  "party full": "That party is full.",
  unreachable: "Can't reach the party server. Check the server address in OpenParty settings.",
  "bad video": "This page's address can't be shared in a party.",
  locked: "Only the host can control playback in this party.",
};
const friendly = (error) => ERRORS[error] || error;

const sessions = new Map(); // tabId -> Session

class Session {
  constructor(tabId, info) {
    this.tabId = tabId;
    // Persisted in storage.session so a restarted worker can resume:
    // { partyId, serverUrl, mode: "create"|"join", welcomed, userId, token, controlLock, video }
    this.info = info;
    this.socket = null;
    this.room = null;
    this.status = "connecting";
    this.frames = new Map(); // frameId -> video score
    this.activeFrame = null;
    this.needsReconnect = false;
    // After creating a party, the host's player state becomes the party state
    // (instead of everyone, host included, jumping to 0:00).
    this.adoptPending = false;
  }

  get me() {
    return this.info.userId;
  }

  get isHost() {
    return !!this.room && this.room.hostId === this.info.userId;
  }

  get inviteUrl() {
    return OPU.inviteUrl(this.info.serverUrl, this.info.partyId);
  }

  persist() {
    return chrome.storage.session.set({ [STORE_PREFIX + this.tabId]: this.info });
  }

  // Resolves with {ok} on the first welcome or {error} if the server refuses or can't be reached.
  connect() {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => settle({ error: "unreachable" }), CONNECT_TIMEOUT_MS);
      this.socket = new PartySocket(this.info.serverUrl, this.info.partyId, {
        hello: (opts) => this.helloPayload(opts),
        welcome: (data) => {
          this.onWelcome(data);
          settle({ ok: true });
        },
        push: (type, data) => this.onPush(type, data),
        fatal: (error) => {
          settle({ error });
          this.onFatal(error);
        },
        status: (status) => this.onStatus(status),
        clock: (offset) => this.sendActive({ op: "clock", offset }),
      });
      this.socket.connect();
    });
  }

  async helloPayload({ recreate }) {
    const settings = await OPU.getSettings();
    const user = { name: settings.name, avatar: settings.avatar };
    if (recreate || (!this.info.welcomed && this.info.mode === "create")) {
      const payload = {
        action: "create",
        user,
        video: (this.room && this.room.video) || this.info.video,
        controlLock: this.room ? this.room.controlLock : this.info.controlLock,
      };
      if (recreate && this.room) payload.playback = { state: this.room.playback.state, timeMs: this.expectedMs() };
      return payload;
    }
    const payload = { action: "join", user };
    if (this.info.userId && this.info.token) Object.assign(payload, { userId: this.info.userId, token: this.info.token });
    return payload;
  }

  expectedMs() {
    const p = this.room.playback;
    const now = Date.now() + (this.socket ? this.socket.offset : 0);
    return Math.max(0, p.timeMs + (p.state === "playing" ? now - p.at : 0));
  }

  onWelcome(data) {
    const first = !this.info.welcomed;
    if (first && this.info.mode === "create") this.adoptPending = true;
    Object.assign(this.info, { welcomed: true, userId: data.userId, token: data.token });
    this.persist();
    this.room = data.room;
    this.needsReconnect = false;
    this.sendTop({ op: "room", room: this.uiRoom(), first });
    this.updateBadge();
    if (this.activeFrame !== null) this.sendActive(this.activation());
    else chrome.tabs.sendMessage(this.tabId, { op: "report" }).catch(() => {});
  }

  onPush(type, data) {
    const room = this.room;
    if (!room) return;
    switch (type) {
      case "state":
        room.playback = { state: data.state, timeMs: data.timeMs, at: data.at };
        this.sendActive({ op: "remote-state", playback: room.playback, by: data.by });
        this.sendTop({ op: "ui", kind: "state", data });
        break;
      case "video":
        room.video = { url: data.url, title: data.title, durationMs: data.durationMs };
        this.sendTop({ op: "ui", kind: "video", data });
        // We moved the party to a new video: our player's position is the truth.
        if (data.by === this.me) this.sendActive({ op: "adopt" });
        break;
      case "users": {
        room.users = data.users;
        const host = data.users.find((u) => u.host);
        if (host) room.hostId = host.id;
        this.sendTop({ op: "ui", kind: "users", data: { users: data.users, isHost: this.isHost } });
        this.sendActive({ op: "role", isHost: this.isHost, locked: room.controlLock });
        this.updateBadge();
        break;
      }
      case "lock":
        room.controlLock = !!data.on;
        this.sendTop({ op: "ui", kind: "lock", data });
        this.sendActive({ op: "role", isHost: this.isHost, locked: room.controlLock });
        break;
      case "chat":
        room.messages.push(data);
        if (room.messages.length > 50) room.messages.shift();
        this.sendTop({ op: "ui", kind: "chat", data });
        break;
      case "react":
      case "notice":
      case "error":
        this.sendTop({ op: "ui", kind: type, data });
        break;
    }
  }

  onFatal(error) {
    // Errors before the first welcome are reported by start/join instead.
    if (!this.info.welcomed) return;
    this.sendTop({ op: "ui", kind: "ended", data: { reason: friendly(error) } });
    endSession(this.tabId, { message: `Party ended: ${friendly(error)}` });
  }

  onStatus(status) {
    this.status = status;
    this.sendTop({ op: "ui", kind: "status", data: { status } });
    this.updateBadge();
  }

  uiRoom() {
    const r = this.room;
    return {
      partyId: r.partyId,
      inviteUrl: this.inviteUrl,
      me: this.me,
      isHost: this.isHost,
      controlLock: r.controlLock,
      video: r.video,
      playback: r.playback,
      users: r.users,
      messages: r.messages,
      status: this.status,
    };
  }

  activation() {
    const adopt = this.adoptPending;
    this.adoptPending = false;
    return {
      op: "activate",
      playback: this.room.playback,
      offset: this.socket ? this.socket.offset : 0,
      locked: this.room.controlLock,
      isHost: this.isHost,
      me: this.me,
      adopt,
    };
  }

  // ---- frame election: the frame with the biggest playing video drives sync ----

  report(frameId, score) {
    if (score > 0) this.frames.set(frameId, score);
    else this.frames.delete(frameId);
    this.elect();
  }

  elect() {
    let best = null;
    let bestScore = 0;
    for (const [id, score] of this.frames) {
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    const current = this.activeFrame;
    if (best === current) return;
    if (current !== null && this.frames.has(current) && bestScore < this.frames.get(current) * FRAME_SWITCH_MARGIN) return;
    this.activeFrame = best;
    if (current !== null) this.sendFrame(current, { op: "deactivate" });
    if (best !== null && this.room) this.sendFrame(best, this.activation());
  }

  sendFrame(frameId, msg) {
    return chrome.tabs.sendMessage(this.tabId, msg, { frameId }).catch(() => {
      if (frameId === this.activeFrame) {
        this.frames.delete(frameId);
        this.activeFrame = null;
        this.elect();
      }
    });
  }

  sendActive(msg) {
    if (this.activeFrame !== null) this.sendFrame(this.activeFrame, msg);
  }

  // New or navigated frames (players that single-page sites add later) get the
  // scripts too. Bursts of frame changes cost one injection.
  reinject() {
    if (this.reinjectTimer) return;
    this.reinjectTimer = setTimeout(() => {
      this.reinjectTimer = null;
      if (sessions.get(this.tabId) === this) inject(this.tabId);
    }, 300);
  }

  sendTop(msg) {
    chrome.tabs.sendMessage(this.tabId, msg, { frameId: 0 }).catch(() => {});
  }

  updateBadge() {
    let text = "…";
    let color = "#E9A23B";
    if (this.needsReconnect) {
      text = "!";
      color = "#d93025";
    } else if (this.status === "connected" && this.room) {
      text = String(this.room.users.length);
    }
    chrome.action.setBadgeText({ tabId: this.tabId, text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId: this.tabId, color }).catch(() => {});
  }
}

// ---- helpers -------------------------------------------------------------

function stripPartyFragment(href) {
  try {
    const u = new URL(href);
    if (u.hash.includes("openparty=")) u.hash = "";
    return u.href;
  } catch {
    return href;
  }
}

async function inject(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { error: "That tab is gone." };
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
  } catch {
    // Some frames may be off-limits; the top frame alone is still useful.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    } catch {
      return { error: "OpenParty can't run on this page. Click the OpenParty icon on the video page to allow it." };
    }
  }
  let hostname = "";
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    // no URL access; skip page helpers
  }
  const page = PAGE_SCRIPTS.find((p) => p.host.test(hostname));
  if (page) {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: [page.file] }).catch(() => {});
  }
  return { ok: true };
}

// Runs inside the page (top frame) to see what the popup is dealing with.
function probePage() {
  const origins = new Set();
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      const rect = frame.getBoundingClientRect();
      if (rect.width * rect.height < 200 * 150) continue;
      const url = new URL(frame.src, location.href);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin !== location.origin) origins.add(url.origin);
    } catch {
      // ignore unparsable frames
    }
  }
  return {
    hasVideo: !!document.querySelector("video"),
    iframeOrigins: [...origins].slice(0, 5),
    title: document.title,
  };
}

async function probe(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: probePage });
    return { ok: true, ...result.result };
  } catch {
    return { error: "OpenParty can't run on this page." };
  }
}

async function endSession(tabId, { notify = true, message } = {}) {
  const s = sessions.get(tabId);
  if (!s) return;
  sessions.delete(tabId);
  if (s.socket) s.socket.close();
  await chrome.storage.session.remove(STORE_PREFIX + tabId);
  if (notify) chrome.tabs.sendMessage(tabId, { op: "left", message }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
}

// Joining works from any tab (even a new tab page); the popup then offers to
// open the party's video, and the tab is set up once that page loads.
async function begin(tabId, info, { requireInjection = true } = {}) {
  const injected = await inject(tabId);
  if (injected.error && requireInjection) return injected;
  const session = new Session(tabId, info);
  sessions.set(tabId, session);
  await session.persist();
  const result = await session.connect();
  if (result.error) {
    await endSession(tabId);
    return { error: friendly(result.error), code: result.error };
  }
  return { ok: true, session };
}

async function startParty(tabId, { controlLock }) {
  if (sessions.has(tabId)) return { error: "This tab is already in a party." };
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { error: "That tab is gone." };
  }
  if (!tab.url || !/^https?:/.test(tab.url)) return { error: "OpenParty only works on web pages." };
  const settings = await OPU.getSettings();
  const video = { url: stripPartyFragment(tab.url), title: tab.title || "", durationMs: 0 };

  // A clash with an existing code is astronomically unlikely, but retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = {
      partyId: OPU.newPartyId(),
      serverUrl: settings.serverUrl,
      mode: "create",
      welcomed: false,
      userId: null,
      token: null,
      controlLock: !!controlLock,
      video,
    };
    const result = await begin(tabId, info);
    if (result.code === "party exists") continue;
    if (result.error) return result;
    return { ok: true, partyId: info.partyId, inviteUrl: result.session.inviteUrl };
  }
  return { error: "Couldn't create a party. Try again." };
}

async function joinParty(tabId, code, explicitServerUrl) {
  const invite = OPU.parseInvite(code);
  if (!invite) return { error: "That doesn't look like an OpenParty link or code." };
  const existing = sessions.get(tabId);
  if (existing) {
    if (existing.info.partyId === invite.partyId) return { ok: true, already: true };
    await endSession(tabId);
  }
  const settings = await OPU.getSettings();
  const serverUrl = OPU.normalizeServerUrl(explicitServerUrl || OPU.serverForInvite(invite, settings));
  if (!serverUrl) return { error: "That invite names an invalid server." };
  const info = {
    partyId: invite.partyId,
    serverUrl,
    mode: "join",
    welcomed: false,
    userId: null,
    token: null,
    controlLock: false,
    video: null,
  };
  const result = await begin(tabId, info, { requireInjection: false });
  if (result.error) return result;
  const tab = await chrome.tabs.get(tabId);
  const video = result.session.room.video;
  return { ok: true, video, sameVideo: OPU.videoKey(tab.url || "") === OPU.videoKey(video.url) };
}

// An invite page (<server>/j/<code>) was opened: remember the invite and show
// OpenParty's join page in that tab, which asks for site access if needed and
// then joins and opens the video.
async function openInvite(tabId, msg) {
  const serverUrl = OPU.normalizeServerUrl(msg.serverUrl);
  let videoUrl = null;
  try {
    const u = new URL(msg.video && msg.video.url);
    if (u.protocol === "https:" || u.protocol === "http:") videoUrl = u.href;
  } catch {
    // invalid URL
  }
  if (!OPU.isPartyId(msg.partyId) || !serverUrl || !videoUrl) return { error: "bad invite" };
  const invite = {
    partyId: msg.partyId,
    serverUrl,
    video: { url: videoUrl, title: String((msg.video && msg.video.title) || "").slice(0, 200) },
    at: Date.now(),
  };
  await chrome.storage.session.set({ [INVITE_PREFIX + tabId]: invite, lastInvite: invite });
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("join/join.html") });
  return { ok: true };
}

async function reconnectTab(tabId) {
  const s = sessions.get(tabId);
  if (!s) return { error: "This tab isn't in a party." };
  const result = await inject(tabId);
  s.needsReconnect = !!result.error;
  s.updateBadge();
  return result;
}

function popupStatus(tabId) {
  const s = sessions.get(tabId);
  if (!s) return { inParty: false };
  return {
    inParty: true,
    partyId: s.info.partyId,
    inviteUrl: s.inviteUrl,
    status: s.status,
    needsReconnect: s.needsReconnect,
    isHost: s.isHost,
    controlLock: s.room ? s.room.controlLock : s.info.controlLock,
    users: s.room ? s.room.users : [],
    video: s.room ? s.room.video : s.info.video,
  };
}

// ---- message routing -----------------------------------------------------

async function handleContent(msg, sender) {
  const tabId = sender.tab.id;
  const frameId = sender.frameId;
  const s = sessions.get(tabId);

  switch (msg.op) {
    case "content-hello":
      if (!s) return { inParty: false };
      return { inParty: true, room: frameId === 0 && s.room ? s.uiRoom() : null, status: s.status };
    case "frame-report":
      if (s) s.report(frameId, Number(msg.score) || 0);
      return {};
    case "frame-gone":
      if (s) s.report(frameId, 0);
      return {};
    case "invite-open":
      return openInvite(tabId, msg);
    case "has-video":
      return { hasVideo: !!s && [...s.frames.values()].some((score) => score > 0) };
    case "frames-changed":
      if (s) s.reinject();
      return {};
    case "local-notice":
      if (s) s.sendTop({ op: "ui", kind: "local", data: { kind: msg.kind } });
      return {};
  }

  if (!s || !s.socket) return { error: "not in a party" };
  switch (msg.op) {
    case "local-state":
      if (frameId !== s.activeFrame) return { error: "inactive frame" };
      return s.socket.request("state", { state: msg.state, timeMs: msg.timeMs, at: msg.at });
    case "video-changed":
      // Only the host moves the party; a guest browsing to the video must not reset it.
      if (frameId !== 0 || !s.room || !s.isHost) return {};
      if (OPU.videoKey(msg.url) === OPU.videoKey(s.room.video.url)) return {};
      return s.socket.request("video", { url: stripPartyFragment(msg.url), title: msg.title, durationMs: msg.durationMs || 0 });
    case "chat":
      return s.socket.request("chat", { text: msg.text });
    case "react":
      return s.socket.request("react", { emoji: msg.emoji });
    case "typing":
    case "buffering":
    case "ads":
      s.socket.send(msg.op, { on: !!msg.on });
      return {};
    case "lock":
      return s.socket.request("lock", { on: !!msg.on });
    case "resync":
      if (s.room) s.sendActive(s.activation());
      return {};
    case "leave":
      leave(tabId);
      await endSession(tabId);
      return {};
  }
  return { error: "unknown op" };
}

async function handleExtensionPage(msg) {
  switch (msg.op) {
    case "status":
      return popupStatus(msg.tabId);
    case "probe":
      return probe(msg.tabId);
    case "start":
      return startParty(msg.tabId, msg);
    case "join":
      return joinParty(msg.tabId, msg.code, msg.serverUrl);
    case "pending-invite": {
      const key = INVITE_PREFIX + msg.tabId;
      return (await chrome.storage.session.get(key))[key] || null;
    }
    case "leave":
      leave(msg.tabId);
      await endSession(msg.tabId);
      return { ok: true };
    case "reconnect":
      return reconnectTab(msg.tabId);
    case "navigate": {
      if (!sessions.has(msg.tabId)) return { error: "This tab isn't in a party." };
      let url;
      try {
        url = new URL(msg.url);
      } catch {
        return { error: "Invalid address." };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Invalid address." };
      await chrome.tabs.update(msg.tabId, { url: url.href });
      return { ok: true };
    }
    case "show-panel": {
      const s = sessions.get(msg.tabId);
      if (s) s.sendTop({ op: "show-panel" });
      return {};
    }
    case "lock": {
      const s = sessions.get(msg.tabId);
      return s && s.socket ? s.socket.request("lock", { on: !!msg.on }) : { error: "not in a party" };
    }
    case "profile-changed": {
      const settings = await OPU.getSettings();
      for (const s of sessions.values()) {
        if (s.socket) s.socket.request("profile", { name: settings.name, avatar: settings.avatar });
      }
      return {};
    }
  }
  return { error: "unknown op" };
}

const restored = restoreSessions();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.op !== "string") return false;
  const fromExtensionPage = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  restored
    .then(() => (fromExtensionPage ? handleExtensionPage(msg) : sender.tab ? handleContent(msg, sender) : { error: "forbidden" }))
    .then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

// ---- tab lifecycle -------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  endSession(tabId, { notify: false });
  chrome.storage.session.remove(INVITE_PREFIX + tabId);
});

// (Re)inject a party tab's scripts. Pages OpenParty can never run on (the
// browser's own pages, OpenParty's join page) don't count as needing a reconnect.
async function refresh(s) {
  const result = await inject(s.tabId);
  let webPage = false;
  try {
    webPage = /^https?:/.test((await chrome.tabs.get(s.tabId)).url || "");
  } catch {
    // tab closed
  }
  s.needsReconnect = !!result.error && webPage;
  s.updateBadge();
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  const s = sessions.get(tabId);
  if (!s) return;
  if (change.status === "loading") {
    s.frames.clear();
    s.activeFrame = null;
  }
  if (change.status === "complete") refresh(s);
});

// Opening an invite address (<video page>#openparty=<code>@<server>) joins that
// party in the tab. Tab addresses are only visible for sites the user gave
// OpenParty access to; elsewhere the popup offers to join instead.
const leftParties = new Set();

function leave(tabId) {
  const s = sessions.get(tabId);
  if (s) leftParties.add(s.info.partyId);
}

async function joinFromAddress(tabId, url) {
  const invite = OPU.parseInvite(url);
  if (!invite || !invite.host || leftParties.has(invite.partyId)) return;
  const s = sessions.get(tabId);
  if (s && s.info.partyId === invite.partyId) return;
  await joinParty(tabId, url);
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && /#openparty=/.test(change.url)) restored.then(() => joinFromAddress(tabId, change.url));
});

// Access granted after a start/join (the prompt may answer after the action
// ran): set party tabs up again so new frames and reloaded pages join in.
chrome.permissions.onAdded.addListener(() => {
  for (const s of sessions.values()) refresh(s);
});

// A restarted service worker picks its parties back up.
async function restoreSessions() {
  const all = await chrome.storage.session.get(null);
  for (const [key, info] of Object.entries(all)) {
    if (!key.startsWith(STORE_PREFIX)) continue;
    const tabId = Number(key.slice(STORE_PREFIX.length));
    try {
      await chrome.tabs.get(tabId);
    } catch {
      await chrome.storage.session.remove(key);
      continue;
    }
    if (!info.welcomed || sessions.has(tabId)) continue;
    const s = new Session(tabId, info);
    sessions.set(tabId, s);
    s.connect();
  }
}

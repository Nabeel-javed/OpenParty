// Transport-agnostic party room logic shared by the Node server and the
// Cloudflare Durable Object. A room is a plain JSON-serialisable object.
// handleMessage/handleClose mutate the room and return the frames to send:
//   { to: "self" | "all" | "others", msg }

export const LIMITS = {
  maxMembers: 50,
  maxFrameBytes: 4096,
  maxChatChars: 500,
  maxNameChars: 24,
  maxAvatarChars: 8,
  maxTitleChars: 200,
  maxUrlChars: 2048,
  maxDurationMs: 48 * 3600 * 1000,
  keptMessages: 50,
  ratePerSecond: 30,
  rateBurst: 60,
  emptyRoomTtlMs: 10 * 60 * 1000,
};

export const REACTIONS = ["👍", "😂", "😮", "😢", "❤️", "🔥", "👏", "🎉"];

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const PARTY_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

export function randomId(length, rand = defaultRandomBytes) {
  const bytes = rand(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function defaultRandomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function isValidPartyId(id) {
  return typeof id === "string" && PARTY_ID_RE.test(id);
}

export function createRoom(partyId) {
  return {
    id: partyId,
    hostId: null, // null until a "create" hello initialises the room
    controlLock: false,
    video: null,
    playback: { state: "paused", timeMs: 0, at: 0 },
    members: {}, // userId -> { id, name, avatar, token, joinedAt }
    online: {}, // userId -> live connection count
    flags: {}, // userId -> { typing, buffering, ads }
    messages: [],
    nextMessageId: 1,
    emptySince: null,
  };
}

export function newConnection(connId, now) {
  return { connId, userId: null, bucket: { tokens: LIMITS.rateBurst, last: now } };
}

export function isEmpty(room) {
  return Object.keys(room.online).length === 0;
}

export function usersList(room) {
  return Object.keys(room.online)
    .map((id) => room.members[id])
    .filter(Boolean)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((m) => {
      const f = room.flags[m.id] || {};
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        host: m.id === room.hostId,
        typing: !!f.typing,
        buffering: !!f.buffering,
        ads: !!f.ads,
      };
    });
}

export function snapshot(room) {
  return {
    partyId: room.id,
    hostId: room.hostId,
    controlLock: room.controlLock,
    video: room.video,
    playback: room.playback,
    users: usersList(room),
    messages: room.messages,
  };
}

// ---- validation helpers -------------------------------------------------

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  // Drop control characters, collapse newlines, trim.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text || text.length > max) return null;
  return text;
}

function cleanName(value) {
  return cleanText(value, LIMITS.maxNameChars) || "Guest";
}

function cleanAvatar(value) {
  return typeof value === "string" && value.length > 0 && value.length <= LIMITS.maxAvatarChars ? value : "🙂";
}

function cleanVideo(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.url !== "string" || v.url.length > LIMITS.maxUrlChars) return null;
  let url;
  try {
    url = new URL(v.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const title = cleanText(v.title || "", LIMITS.maxTitleChars) || url.hostname;
  const durationMs = finiteIn(v.durationMs, 0, LIMITS.maxDurationMs) ? Math.round(v.durationMs) : 0;
  return { url: url.href, title, durationMs };
}

function finiteIn(n, lo, hi) {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
}

function takeToken(conn, now) {
  const b = conn.bucket;
  b.tokens = Math.min(LIMITS.rateBurst, b.tokens + ((now - b.last) / 1000) * LIMITS.ratePerSecond);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---- message handling ---------------------------------------------------

export function handleMessage(room, conn, raw, now, rand = defaultRandomBytes) {
  const out = [];
  const push = (to, type, data) => out.push({ to, msg: { type, data } });

  if (typeof raw === "string" && raw.length > LIMITS.maxFrameBytes) {
    return { out: [{ to: "self", msg: { type: "error", data: { message: "frame too large" } } }], close: true };
  }
  if (!takeToken(conn, now)) return { out }; // silently drop floods

  let msg;
  try {
    msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { out };
  }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return { out };

  const id = Number.isInteger(msg.id) ? msg.id : null;
  const data = msg.data && typeof msg.data === "object" ? msg.data : {};
  const reply = (body) => {
    if (id !== null) out.push({ to: "self", msg: { type: "reply", id, data: body || {} } });
  };
  const fail = (error) => {
    if (id !== null) out.push({ to: "self", msg: { type: "reply", id, error } });
  };

  if (msg.type === "ping") {
    push("self", "pong", {});
    return { out };
  }
  if (msg.type === "time") {
    reply({ now });
    return { out };
  }

  if (msg.type === "hello") {
    handleHello(room, conn, data, now, rand, { push, reply, fail });
    return { out };
  }

  if (!conn.userId) {
    fail("say hello first");
    return { out };
  }
  const userId = conn.userId;
  const member = room.members[userId];
  const canControl = !room.controlLock || userId === room.hostId;

  switch (msg.type) {
    case "state": {
      if (!canControl) { fail("locked"); break; }
      if (data.state !== "playing" && data.state !== "paused") { fail("bad state"); break; }
      if (!finiteIn(data.timeMs, 0, LIMITS.maxDurationMs)) { fail("bad time"); break; }
      const at = finiteIn(data.at, now - 5000, now + 1000) ? Math.round(data.at) : now;
      room.playback = { state: data.state, timeMs: Math.round(data.timeMs), at };
      push("all", "state", { ...room.playback, by: userId });
      reply({});
      break;
    }
    case "video": {
      if (!canControl) { fail("locked"); break; }
      const video = cleanVideo(data);
      if (!video) { fail("bad video"); break; }
      room.video = video;
      room.playback = { state: "paused", timeMs: 0, at: now };
      push("all", "video", { ...video, by: userId });
      push("all", "state", { ...room.playback, by: userId });
      reply({});
      break;
    }
    case "chat": {
      const text = cleanText(data.text, LIMITS.maxChatChars);
      if (!text) { fail("bad text"); break; }
      const message = {
        id: room.nextMessageId++,
        from: userId,
        name: member.name,
        avatar: member.avatar,
        text,
        ts: now,
      };
      room.messages.push(message);
      if (room.messages.length > LIMITS.keptMessages) room.messages.shift();
      if (room.flags[userId]) room.flags[userId].typing = false;
      push("all", "chat", message);
      reply({});
      break;
    }
    case "react": {
      if (!REACTIONS.includes(data.emoji)) { fail("bad emoji"); break; }
      push("all", "react", { from: userId, name: member.name, emoji: data.emoji });
      reply({});
      break;
    }
    case "typing":
    case "buffering":
    case "ads": {
      const flags = (room.flags[userId] ||= { typing: false, buffering: false, ads: false });
      const on = !!data.on;
      if (flags[msg.type] !== on) {
        flags[msg.type] = on;
        push("all", "users", { users: usersList(room) });
      }
      reply({});
      break;
    }
    case "profile": {
      member.name = cleanName(data.name);
      member.avatar = cleanAvatar(data.avatar);
      push("all", "users", { users: usersList(room) });
      reply({});
      break;
    }
    case "lock": {
      if (userId !== room.hostId) { fail("host only"); break; }
      room.controlLock = !!data.on;
      push("all", "lock", { on: room.controlLock });
      push("all", "notice", { kind: "lock", name: member.name, on: room.controlLock });
      reply({});
      break;
    }
    default:
      fail("unknown type");
  }
  return { out };
}

function handleHello(room, conn, data, now, rand, { push, reply, fail }) {
  if (conn.userId) return fail("already joined");
  const action = data.action;
  if (action === "create") {
    if (room.hostId) return fail("party exists");
    const video = cleanVideo(data.video);
    if (!video) return fail("bad video");
    room.video = video;
    room.controlLock = !!data.controlLock;
    room.playback = { state: "paused", timeMs: 0, at: now };
  } else if (action === "join") {
    if (!room.hostId) return fail("no such party");
  } else {
    return fail("bad action");
  }

  let member = null;
  if (typeof data.userId === "string" && typeof data.token === "string") {
    const known = room.members[data.userId];
    if (known && known.token === data.token) member = known;
  }
  const isNew = !member;
  if (isNew && Object.keys(room.online).length >= LIMITS.maxMembers) return fail("party full");
  if (isNew) {
    member = { id: "u_" + randomId(12, rand), token: randomId(24, rand), joinedAt: now };
    room.members[member.id] = member;
  }
  member.name = cleanName(data.user && data.user.name);
  member.avatar = cleanAvatar(data.user && data.user.avatar);
  if (action === "create") room.hostId = member.id;

  conn.userId = member.id;
  const wasOnline = (room.online[member.id] || 0) > 0;
  room.online[member.id] = (room.online[member.id] || 0) + 1;
  room.emptySince = null;

  // A returning host gets the role back only if nobody took it over.
  if (!room.online[room.hostId]) room.hostId = member.id;

  reply({ partyId: room.id, userId: member.id, token: member.token, room: snapshot(room) });
  if (!wasOnline) {
    push("others", "notice", { kind: "join", name: member.name });
    push("all", "users", { users: usersList(room) });
  }
}

export function handleClose(room, conn, now) {
  const out = [];
  const userId = conn.userId;
  if (!userId || !room.online[userId]) return { out };
  conn.userId = null;
  room.online[userId] -= 1;
  if (room.online[userId] > 0) return { out };

  delete room.online[userId];
  delete room.flags[userId];
  const member = room.members[userId];
  out.push({ to: "others", msg: { type: "notice", data: { kind: "leave", name: member ? member.name : "Someone" } } });

  if (room.hostId === userId) {
    const next = usersList(room)[0];
    if (next) {
      room.hostId = next.id;
      out.push({ to: "others", msg: { type: "notice", data: { kind: "host", name: next.name } } });
    }
  }
  if (isEmpty(room)) room.emptySince = now;
  else out.push({ to: "others", msg: { type: "users", data: { users: usersList(room) } } });
  return { out };
}

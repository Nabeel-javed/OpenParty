// Cloudflare Workers deployment: one Durable Object per party, using the
// WebSocket Hibernation API so idle parties cost nothing between messages.

import { DurableObject } from "cloudflare:workers";
import {
  createRoom,
  newConnection,
  handleMessage,
  handleClose,
  isEmpty,
  isValidPartyId,
  LIMITS,
} from "../../core/party.js";
import { invitePage, infoPage, HTML_HEADERS } from "../../core/pages.js";

const ROUTE = /^\/(ws|j)\/([^/]+)$/;
// Message types that change room state worth persisting across hibernation.
const PERSISTED_TYPES = new Set(["hello", "state", "video", "chat", "profile", "lock"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/") return new Response(infoPage(), { headers: HTML_HEADERS });
    const match = url.pathname.match(ROUTE);
    if (match && isValidPartyId(match[2])) {
      return env.PARTY.get(env.PARTY.idFromName(match[2])).fetch(request);
    }
    return new Response("not found", { status: 404 });
  },
};

export class Party extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.conns = new Map(); // WebSocket -> connection (rate-limit state lives in memory only)
    // Answer keepalives without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong","data":{}}'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get("room")) || null;
      if (this.room) this.recountOnline();
    });
  }

  // After a restart the stored online counts may be stale; trust the live sockets.
  recountOnline() {
    const online = {};
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.userId) online[att.userId] = (online[att.userId] || 0) + 1;
    }
    this.room.online = online;
    if (isEmpty(this.room) && this.room.emptySince === null) this.room.emptySince = Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const [, kind, partyId] = url.pathname.match(ROUTE);

    if (kind === "j") {
      const found = this.room && this.room.hostId;
      return new Response(invitePage(found ? this.room : null, url.host), {
        status: found ? 200 : 404,
        headers: HTML_HEADERS,
      });
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (!this.room) this.room = createRoom(partyId);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connId: crypto.randomUUID(), userId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  connFor(ws) {
    let conn = this.conns.get(ws);
    if (!conn) {
      const att = ws.deserializeAttachment() || {};
      conn = newConnection(att.connId || crypto.randomUUID(), Date.now());
      conn.userId = att.userId || null;
      this.conns.set(ws, conn);
    }
    return conn;
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || !this.room) return;
    const conn = this.connFor(ws);
    const before = conn.userId;
    const result = handleMessage(this.room, conn, message, Date.now());
    if (conn.userId !== before) ws.serializeAttachment({ connId: conn.connId, userId: conn.userId });
    this.deliver(ws, result.out);
    if (result.close) ws.close(1009, "frame too large");
    if (PERSISTED_TYPES.has(peekType(message)) && this.room.hostId) {
      await this.ctx.storage.put("room", this.room);
    }
  }

  async webSocketClose(ws, code) {
    await this.closeConnection(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  async webSocketError(ws) {
    await this.closeConnection(ws);
  }

  async closeConnection(ws) {
    if (!this.room) return;
    const conn = this.connFor(ws);
    this.conns.delete(ws);
    const result = handleClose(this.room, conn, Date.now());
    this.deliver(ws, result.out);
    if (!this.room.hostId) return;
    await this.ctx.storage.put("room", this.room);
    if (isEmpty(this.room)) await this.ctx.storage.setAlarm(Date.now() + LIMITS.emptyRoomTtlMs);
  }

  async alarm() {
    if (this.room && isEmpty(this.room) && Date.now() - (this.room.emptySince ?? 0) >= LIMITS.emptyRoomTtlMs) {
      await this.ctx.storage.deleteAll();
      this.room = null;
    }
  }

  deliver(self, out) {
    if (out.length === 0) return;
    const sockets = this.ctx.getWebSockets();
    for (const { to, msg } of out) {
      const json = JSON.stringify(msg);
      if (to === "self") {
        safeSend(self, json);
        continue;
      }
      for (const ws of sockets) {
        if (to === "others" && ws === self) continue;
        const att = ws.deserializeAttachment();
        if (att && att.userId) safeSend(ws, json);
      }
    }
  }
}

function peekType(message) {
  try {
    return JSON.parse(message).type;
  } catch {
    return null;
  }
}

function safeSend(ws, json) {
  try {
    ws.send(json);
  } catch {
    // socket closing
  }
}

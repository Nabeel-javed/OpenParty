// Self-hostable OpenParty server: one process, rooms kept in memory.
//   PORT         listen port (default 8787)
//   PUBLIC_HOST  host name used in invite links (default: the request's Host header)

import http from "node:http";
import { WebSocketServer } from "ws";
import {
  createRoom,
  newConnection,
  handleMessage,
  handleClose,
  isEmpty,
  isValidPartyId,
  LIMITS,
} from "../core/party.js";
import { invitePage, infoPage, HTML_HEADERS } from "../core/pages.js";

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC_HOST = process.env.PUBLIC_HOST || null;
const HEARTBEAT_MS = 30_000;
const SWEEP_MS = 60_000;

const rooms = new Map(); // partyId -> { room, sockets: Set<WebSocket> }
let nextConnId = 1;

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  if (pathname === "/") {
    res.writeHead(200, HTML_HEADERS);
    return res.end(infoPage());
  }
  const invite = pathname.match(/^\/j\/([^/]+)$/);
  if (invite) {
    const entry = isValidPartyId(invite[1]) ? rooms.get(invite[1]) : undefined;
    const found = entry && entry.room.hostId;
    res.writeHead(found ? 200 : 404, HTML_HEADERS);
    return res.end(invitePage(found ? entry.room : null, PUBLIC_HOST || req.headers.host));
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxFrameBytes });

server.on("upgrade", (req, socket, head) => {
  const match = new URL(req.url, "http://localhost").pathname.match(/^\/ws\/([^/]+)$/);
  if (!match || !isValidPartyId(match[1])) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, match[1]));
});

function attach(ws, partyId) {
  let entry = rooms.get(partyId);
  if (!entry) {
    entry = { room: createRoom(partyId), sockets: new Set() };
    rooms.set(partyId, entry);
  }
  const conn = newConnection(nextConnId++, Date.now());
  ws.conn = conn;
  ws.isAlive = true;
  entry.sockets.add(ws);

  const helloTimer = setTimeout(() => {
    if (!conn.userId) ws.close(4000, "hello timeout");
  }, 10_000);

  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const result = handleMessage(entry.room, conn, data.toString(), Date.now());
    deliver(entry, ws, result.out);
    if (result.close) ws.close(1009, "frame too large");
  });
  ws.on("close", () => {
    clearTimeout(helloTimer);
    entry.sockets.delete(ws);
    deliver(entry, ws, handleClose(entry.room, conn, Date.now()).out);
  });
  ws.on("error", () => ws.terminate());
}

function deliver(entry, self, out) {
  for (const { to, msg } of out) {
    const json = JSON.stringify(msg);
    if (to === "self") {
      send(self, json);
      continue;
    }
    for (const ws of entry.sockets) {
      if (!ws.conn.userId) continue; // not in the party yet
      if (to === "others" && ws === self) continue;
      send(ws, json);
    }
  }
}

function send(ws, json) {
  if (ws.readyState === ws.OPEN) ws.send(json);
}

// Drop connections that stopped answering pings.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

// Forget rooms that nobody created, and rooms empty for longer than the TTL.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of rooms) {
    if (entry.sockets.size > 0) continue;
    const expired = !entry.room.hostId || (isEmpty(entry.room) && now - (entry.room.emptySince ?? 0) > LIMITS.emptyRoomTtlMs);
    if (expired) rooms.delete(id);
  }
}, SWEEP_MS);

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(sweep);
  for (const ws of wss.clients) ws.close(1001, "server shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(PORT, () => console.log(`OpenParty server listening on :${PORT}`));

export { server };

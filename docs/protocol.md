# OpenParty wire protocol (v1)

One WebSocket per party member: `wss://<server>/ws/<partyId>`. Every frame is a JSON text message.

- Party ids are 10 characters from `23456789abcdefghjkmnpqrstuvwxyz` (no lookalikes). Clients generate the id when creating a party.
- Times are milliseconds. `at` timestamps are **server clock** (`Date.now()` on the server). Clients estimate the server clock with `time` requests.

## Envelope

| Direction | Shape |
|---|---|
| client → server | `{ "type": string, "id"?: number, "data"?: object }` |
| server reply | `{ "type": "reply", "id": number, "data"?: object, "error"?: string }` |
| server push | `{ "type": string, "data": object }` |

A request with an `id` always gets exactly one `reply` with the same `id`. Frames over 4 KB are rejected.

## Client → server

| type | data | reply data | notes |
|---|---|---|---|
| `hello` | `action: "create" \| "join"`, `user: {name, avatar}`, `video?: {url, title, durationMs}`, `controlLock?: bool`, `userId?`, `token?` | `{partyId, userId, token, room}` | Must be the first message. `create` fails if the party exists; `join` fails if it doesn't. Sending a previous `userId` + `token` resumes that identity (reconnects, page reloads). |
| `time` | `{}` | `{now}` | Server clock, for offset estimation. |
| `state` | `state: "playing" \| "paused"`, `timeMs`, `at` | `{}` | Playback change. Rejected with `locked` if control is locked and the sender is not the host. The server clamps `at` to `[now − 5000, now + 1000]`. |
| `video` | `url`, `title`, `durationMs` | `{}` | The party moved to another video (next episode). Same lock rule as `state`. |
| `chat` | `text` (1–500 chars) | `{}` | |
| `react` | `emoji` (one of `👍 😂 😮 😢 ❤️ 🔥 👏 🎉`) | `{}` | |
| `typing` | `on: bool` | — | |
| `buffering` | `on: bool` | — | |
| `ads` | `on: bool` | — | The member is watching an ad. |
| `profile` | `name`, `avatar` | `{}` | |
| `lock` | `on: bool` | `{}` | Host only. Toggles control lock. |
| `ping` | — | — | Keepalive; the server answers with a `pong` push. Clients send one every 20 s. |

## Server → client pushes

| type | data |
|---|---|
| `state` | `{state, timeMs, at, by}`: the new party playback state (also sent to the sender, so all clients converge on the server's copy) |
| `video` | `{url, title, durationMs, by}` |
| `chat` | `{id, from, name, avatar, text, ts}` |
| `react` | `{from, name, emoji}` |
| `users` | `{users: [{id, name, avatar, host, typing, buffering, ads}]}` |
| `notice` | `{kind: "join" \| "leave" \| "host" \| "lock", name, on?}` |
| `lock` | `{on}` |
| `pong` | `{}` |
| `error` | `{message}` (fatal; the server closes the socket afterwards) |

## Room snapshot (`hello` reply)

```json
{
  "partyId": "k3m9q2x7pa",
  "hostId": "u_…",
  "controlLock": false,
  "video": { "url": "https://…", "title": "…", "durationMs": 0 },
  "playback": { "state": "paused", "timeMs": 0, "at": 1761300000000 },
  "users": [ … ],
  "messages": [ … last 50 chat messages … ]
}
```

## Party time

```
expectedTimeMs = playback.timeMs + (playback.state == "playing" ? serverNow − playback.at : 0)
serverNow      = Date.now() + clockOffset
clockOffset    = median of the last 5 samples of (reply.now + rtt/2 − receiveTime)
```

## Limits

- 50 members per party, 4 KB per frame, 30 frames per second per connection (bursts of 60).
- A party is deleted 10 minutes after its last member leaves.
- If the host leaves, the longest-connected remaining member becomes host.

## HTTP routes

| route | purpose |
|---|---|
| `GET /` | short info page |
| `GET /healthz` | `ok` |
| `GET /j/<partyId>` | invite page: shows the video title and links to `<videoUrl>#openparty=<partyId>@<serverHost>` |
| `GET /ws/<partyId>` | WebSocket upgrade |

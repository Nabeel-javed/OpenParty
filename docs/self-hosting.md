# Running an OpenParty server

OpenParty works out of the box with the free public server (`https://openparty.openparty-worker.workers.dev`, deployed from `server/worker`). Run your own if you want full control over where party data goes.

The server is a small relay: it keeps each party's playback state, members and recent chat, and forwards changes between members. Two interchangeable implementations share the same core (`server/core/`) and speak the same [protocol](protocol.md).

| | Node (`server/node`) | Cloudflare (`server/worker`) |
|---|---|---|
| Runs on | any machine with Node 20+, or Docker | Cloudflare Workers + Durable Objects |
| Cost | your server | free tier is plenty for small groups |
| Survives restarts | parties are recreated automatically by the first member who reconnects | yes (state is persisted) |
| Scaling | one process | one Durable Object per party, global |

## Node

```sh
cd server/node
npm install
PORT=8787 npm start
```

Environment variables:

- `PORT`: listen port (default `8787`)
- `PUBLIC_HOST`: host name used in invite links, e.g. `party.example.com` (default: the request's `Host` header)

Put it behind HTTPS (Caddy, nginx, Traefik, a tunnel…). Browsers require `wss://` for pages served over HTTPS, so a public server must have TLS. A minimal Caddyfile:

```
party.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

## Docker

From the repository root:

```sh
docker build -f server/node/Dockerfile -t openparty-server .
docker run -d --restart unless-stopped -p 8787:8787 -e PUBLIC_HOST=party.example.com openparty-server
```

## Cloudflare Workers

1. Create a free Cloudflare account.
2. Deploy:

   ```sh
   cd server/worker
   npm install
   npx wrangler login
   npx wrangler deploy
   ```

3. Wrangler prints the URL, e.g. `https://openparty.<your-subdomain>.workers.dev`. Add a custom domain in the Cloudflare dashboard if you like.

The Worker uses SQLite-backed Durable Objects, which the free plan supports, and the WebSocket Hibernation API, so idle parties cost nothing. Keepalive pings are answered without waking the party.

Local development: `npx wrangler dev` (no account needed).

## Point the extension at your server

- **Just you:** OpenParty settings → *Sync server* → enter `https://party.example.com` → **Test** → **Save**.
- **Everyone using your build:** change `DEFAULT_SERVER_URL` in `extension/shared/util.js`.

Invite links carry the server (`/j/<code>` pages and `#openparty=<code>@<host>`), so friends join your server even if their default is different.

## Checking it works

- `GET /healthz` returns `ok`.
- `GET /` shows a short info page.
- `npm test` at the repository root runs the same end-to-end scenario against both implementations (the Worker test runs if `server/worker` dependencies are installed).

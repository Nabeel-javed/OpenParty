# OpenParty

**Free, open-source watch parties for any website with a video player.** Press play together, chat and react while you watch. No accounts, no premium tier, no ads, no tracking.

- **Works on (almost) any site.** OpenParty finds the page's main `<video>`, including players inside iframes and shadow DOM, and keeps everyone in sync. Sites with special players get small adapters (Netflix today; contributions welcome).
- **Everyone stays in step.** Play, pause and seek from anyone in the party (or lock control to the host). Clocks are synchronised against the server, so the party drifts less than a second apart.
- **Chat, reactions and a member list** in a panel next to the video, also in fullscreen.
- **Next episode follows along.** When the host moves to another video, everyone else is taken there.
- **Private by design.** Nothing is collected, and OpenParty only runs in tabs that are in a party. The server relays a party's state and forgets it 10 minutes after everyone leaves. See [PRIVACY.md](PRIVACY.md).
- **Run your own server** in one command, with Node, Docker or Cloudflare's free tier. Invite links carry the server address, so friends join the right one automatically.

Everyone in a party needs their own access to the site being watched (their own subscription for paid services).

## Install

OpenParty isn't in the Chrome Web Store yet. To try it now:

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
3. Pin the OpenParty icon to the toolbar.

Works in Chrome, Edge, Brave, Opera, Vivaldi and other Chromium browsers (version 116+).

## Use it

**Start a party:** open the video, click the OpenParty icon and press **Start a party** (the very first time, allow OpenParty access to websites). Copy the invite link from the popup or the 🔗 button in the panel and send it to your friends.

**Join a party:** just open the invite link. With OpenParty installed you're taken straight into the party on the video. The very first time, press **Join party** and allow OpenParty access to websites. You can also paste a link or code into the popup from any tab.

**In the party:** play, pause and seek as usual and everyone follows. The 🍿 button opens the panel with chat, reactions and members. The host can lock playback (🔒) so only they control it.

## How it works

```
 popup ──┐                        ┌── the frame with the video: sync engine
         ├─ extension service ────┤
 panel ──┘   worker (one socket   └── the top frame: party panel (chat, members)
             per party tab)
                    │  WebSocket (JSON)
                    ▼
          OpenParty server: relays state, chat and presence;
          one room per party (Node process or Durable Object)
```

- The server stores each party's playback as `{state, timeMs, at}`, with `at` on the server clock. Each client estimates its offset to that clock (median of recent round trips) and computes where the party is right now.
- The sync engine watches the video's own events. A local play, pause or seek is broadcast. A remote change is applied when the player is more than 1 s off, and a 1 s drift check corrects anything over 2.5 s. Changes the engine makes itself are never echoed back.
- Ads, live streams, buffering, autoplay blocking and browser-paused background tabs are handled explicitly; see `extension/content/sync.js`.

Protocol details: [docs/protocol.md](docs/protocol.md).

## Run a server

You don't need one: OpenParty uses the free public server at `openparty.openparty-worker.workers.dev` (this repository's `server/worker`, on Cloudflare). To run your own:

```sh
# Node (any machine)
cd server/node && npm install && npm start              # listens on :8787

# Docker
docker build -f server/node/Dockerfile -t openparty-server .
docker run -p 8787:8787 openparty-server

# Cloudflare Workers + Durable Objects (free tier)
cd server/worker && npm install && npx wrangler deploy
```

Then set the server address in OpenParty's settings. Full guide: [docs/self-hosting.md](docs/self-hosting.md).

## Develop

```sh
npm test                      # unit + end-to-end tests (Node 22+)
node tools/browser-e2e.mjs --chromium /path/to/Chromium --video clip.webm   # real-browser test
OPENPARTY_LIVE_URL=https://openparty.openparty-worker.workers.dev node --test test/live.e2e.test.js   # check a deployed server
```

See [CONTRIBUTING.md](CONTRIBUTING.md), including how to add support for a site.

## License

[MIT](LICENSE). OpenParty is an independent project and isn't affiliated with any streaming service or any other watch-party product.

# Privacy

OpenParty collects nothing about you. There are no accounts, analytics, ads, trackers, crash reporters or "telemetry".

## What the extension does

- It only runs on a page while that tab is in a party you started or joined. It doesn't read pages, browsing history, cookies, or your accounts on the sites you watch.
- It stores your chosen name and avatar, and the server address, in your browser (`chrome.storage.local`). It never sends them anywhere except to the party you're in.
- It asks once for access to websites, the first time you start or join a party, so it can sync videos on any site. It still only runs in tabs that are in a party. You can remove access anytime in OpenParty's settings or in `chrome://extensions`.

## What the server sees

To run a party, the sync server receives:

| Data | Why |
|---|---|
| The video page's address and title | So friends can open the same video (shown on the invite page) |
| Playback state: playing/paused and position | To keep everyone in sync |
| Display names, avatars, chat messages and reactions | To show them to the other members |
| "Typing", "buffering" and "watching an ad" flags | To show them to the other members |
| Your IP address | Unavoidable for any network connection |

The server keeps a party in memory (or in Durable Object storage on Cloudflare) only while it's in use. Everything is deleted 10 minutes after the last member leaves. The reference servers in this repository write no logs about parties or people.

The default server, `openparty.openparty-worker.workers.dev`, runs this repository's code on Cloudflare Workers with request logging turned off. Cloudflare, as the host, handles the network traffic under [its own privacy policy](https://www.cloudflare.com/privacypolicy/). If you use someone else's server, they operate it. If you want full control, run your own (see [docs/self-hosting.md](docs/self-hosting.md)).

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Let OpenParty look at the tab you clicked the icon on, to find its video |
| `scripting` | Inject the sync engine and panel into a party tab |
| `storage` | Remember your name, avatar, server and the parties your tabs are in |
| Optional access to websites | Asked for once, on first use, so OpenParty can sync the video on any site and keep the party through reloads and episode changes. Used only in party tabs |

# Chrome Web Store listing

Everything to paste into the [developer dashboard](https://chrome.google.com/webstore/devconsole), by tab. Images are in this folder; regenerate them with `tools/store-assets.mjs`. Build the upload with `npm run package` (writes `dist/openparty-<version>.zip`).

## Package

Upload `dist/openparty-<version>.zip`. It is the `extension/` folder exactly as in this repository.

## Store listing

**Description**

```text
OpenParty lets you watch videos together with friends, wherever they are. Play, pause or skip and everyone stays in step, while you chat and react next to the video.

It's free and open source: no premium tier, no accounts, no ads and no tracking.

HOW IT WORKS
1. Open a video on almost any site and click the OpenParty icon.
2. Press "Start a party" and send the invite link to your friends.
3. Friends with OpenParty open the link and land in the party, on the same video, at the same moment.

FEATURES
• Works on almost any website with a video player, including players embedded in other pages.
• Play, pause and seek from anyone, or lock control to the host.
• Chat, emoji reactions and a member list, also in fullscreen.
• When the host moves on to the next episode, everyone follows.
• Copes with ads, buffering and live streams: whoever sits through an ad catches up afterwards.
• Pick a name and an avatar. No sign-up.

PRIVACY
OpenParty only runs in tabs that are in a party. It asks once for access to websites, the first time you start or join a party, so it can work on whichever video site you choose. The sync server sees only what a party needs (the video's address and title, the playback position, names and chat) and forgets a party 10 minutes after everyone leaves. Nothing is sold or shared, and there are no analytics.

OPEN SOURCE
The extension and the server are on GitHub under the MIT licence: https://github.com/Nabeel-javed/OpenParty
You can run your own sync server with Node, Docker or Cloudflare's free tier.

Everyone in a party needs their own access to the video (their own subscription for paid services).

Screenshots show Big Buck Bunny (© Blender Foundation, bigbuckbunny.org, CC BY 3.0).
```

The short summary comes from `description` in `manifest.json` (127 of 132 characters).

| Field | Value |
|---|---|
| Category | Entertainment |
| Language | English |
| Store icon | `icon128.png` |
| Screenshots | `screenshot-1-party.png`, `screenshot-2-popup.png`, `screenshot-3-invite.png`, `screenshot-4-settings.png` |
| Small promo tile | `promo-small-440x280.png` |
| Marquee promo tile | `promo-marquee-1400x560.png` |
| Official URL | none (needs a verified domain) |
| Homepage URL | `https://github.com/Nabeel-javed/OpenParty` |
| Support URL | `https://github.com/Nabeel-javed/OpenParty/issues` |
| Mature content | No |

## Privacy

**Single purpose**

```text
OpenParty lets friends watch the same video together: it keeps playback in sync for everyone in a party and shows a chat panel next to the video.
```

**Permission justifications**

`storage`

```text
Saves the user's display name, avatar and sync-server address, and remembers which tabs are in a party so the party survives page reloads.
```

`scripting`

```text
Injects OpenParty's sync engine and chat panel into a tab, only when the user starts or joins a party in that tab.
```

`activeTab`

```text
When the user clicks the toolbar icon, OpenParty looks for a video in the current tab so it can offer to start a party there.
```

Host permissions (optional access to all sites, and the content script on `party.openparty.workers.dev/j/*`)

```text
Access to all sites is optional and requested once, when the user first clicks "Start a party" or "Join". A watch party has to work on whichever video site the user picks, keep working when the page reloads, and follow the host to the next episode on a new page; activeTab alone can't do that. OpenParty only runs in tabs that are in a party. The content script runs only on invite pages of OpenParty's own server (party.openparty.workers.dev/j/...), so an invited friend can join with one click.
```

**Remote code:** No, I am not using remote code. (All JavaScript is in the package; the server only exchanges JSON messages.)

**Data usage.** Tick these, as they're sent to the sync server while a party runs:

- [x] Personal communications (chat messages)
- [x] Website content (the title of the video being watched)
- [x] Web history (the address of the video page in the party, so friends can open it)
- [x] User activity (play, pause and seek, to sync everyone)

Leave the rest unticked. Names are self-chosen nicknames with no account behind them, and nothing else is collected.

Tick all three certifications: no selling or transferring data to third parties, no use unrelated to the single purpose, no use for creditworthiness or lending.

**Privacy policy URL:** `https://github.com/Nabeel-javed/OpenParty/blob/main/PRIVACY.md`

## Distribution

Free, public, all regions.

## Test instructions (for the reviewer)

```text
No account or login is needed.
1. Open any page with a video, for example https://www.youtube.com/watch?v=aqz-KE-bpKQ (Big Buck Bunny).
2. Click the OpenParty icon and press "Start a party". Allow access to websites when asked.
3. Copy the invite link from the popup and open it in a second Chrome profile with OpenParty installed (or paste it into the popup's "Join" field there).
4. Play, pause or seek in either window; the other follows. Use the chat panel (popcorn button) to chat and react.
```

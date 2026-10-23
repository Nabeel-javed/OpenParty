# Contributing to OpenParty

Thanks for helping! The most valuable contributions are **site support** (making OpenParty work well on another streaming site) and bug reports with clear steps.

## Layout

```
extension/                 the browser extension (plain JavaScript, no build step)
  manifest.json
  background.js            service worker: one party session per tab, frame election, routing
  background/party-socket.js   WebSocket client: hello, reconnects, clock offset
  shared/util.js           helpers shared by every context (codes, invites, URLs, settings)
  content/                 injected into party tabs, in this order:
    ns.js                  namespace, video discovery and scoring
    sites.js               per-site config (selectors, ad detection, adapter choice)
    adapters/html5.js      default adapter: plain <video>
    adapters/netflix.js    example of a site-specific adapter
    sync.js                the sync engine
    ui.js                  the party panel (top frame only)
    main.js                entry point
  page/                    page-world helpers for sites whose player needs its own API
  popup/, options/         extension pages
server/
  core/                    room logic and pages shared by both servers
  node/                    self-hostable Node server (+ Dockerfile)
  worker/                  Cloudflare Worker + Durable Object
test/                      node:test unit and end-to-end tests
tools/                     icon generator, real-browser test
docs/                      protocol and self-hosting
```

## Running things

```sh
npm test                                   # all tests (Node 22+)
cd server/node && npm install && npm start # local server on :8787
```

Load `extension/` unpacked in `chrome://extensions`. Its default server is `http://localhost:8787` until a public server is configured.

To test with two "people" on one machine, use two browser profiles (or one normal and one guest window) with the extension loaded in both.

The real-browser test drives two tabs in Chromium over DevTools and checks start, join, play/pause/seek both ways, chat and host lock:

```sh
node tools/browser-e2e.mjs --chromium /path/to/Chromium --video clip.webm
```

(See the comment at the top of `tools/browser-e2e.mjs` for making a suitable clip with ffmpeg.)

## Adding a site

Most sites need **nothing**: OpenParty drives their `<video>` element directly. Try the site first.

If something's off, add an entry to `OP.sites` in `extension/content/sites.js`:

- **Wrong video picked** (previews, background loops): set `video` to a CSS selector for the main player's `<video>`.
- **Ads break sync:** set `ad` to a selector that exists and is visible only while an ad plays. While it matches, your sync pauses and others see "watching an ad".

If the site's player misbehaves when `play()`, `pause()` or `currentTime` are used directly (errors, desync, ignored seeks), write an adapter:

1. Create `extension/content/adapters/<site>.js` extending `OP.Html5Adapter`; override `play`, `pause` and/or `seek`.
2. If the player's API is only reachable from the page itself, add `extension/page/<site>.js` and register it in `PAGE_SCRIPTS` in `background.js`. Talk to it with `window.postMessage` on the same window, as `adapters/netflix.js` does.
3. Add the file to `CONTENT_FILES` in `background.js` (before `content/sync.js`) and set `adapter: "<site>"` in `sites.js`.
4. Test it with a real party (two profiles), including seeking, pausing, ads, and going to the next episode.

Adapter interface (see `adapters/html5.js`): `attach(listener)`, `detach()`, `timeMs()`, `durationMs()`, `paused()`, `seeking()`, `live()`, `inAd()`, `backgroundSuspended()`, `play() → "ok" | "blocked" | "failed"`, `pause()`, `seek(ms)`.

## Rules

- **Write your own code.** Don't copy code from other (especially proprietary) extensions. Describing how a site's player works (selectors, public player APIs, timing quirks) is fine; pasting someone else's implementation isn't.
- **Privacy is a feature.** No analytics, trackers, remote code, or collecting data a party doesn't need. Don't read users' accounts, history or cookies on the sites they watch.
- **Keep permissions minimal.** New permissions need a strong reason.
- **No build step** in the extension: plain JavaScript that loads as-is. Every content file is an IIFE that attaches to `globalThis.OP`, so re-injection is safe.
- User-provided text goes into the DOM with `textContent`, never `innerHTML`.
- Add or update tests for logic changes (`server/core`, `extension/shared`, `extension/content/sync.js` are unit-tested).

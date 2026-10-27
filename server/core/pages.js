// Small HTML pages served by both server implementations.

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The fragment survives navigation without reaching the video site's server.
// Sites that already route on the fragment keep their URL; members join with the code instead.
export function inviteLink(video, partyId, host) {
  const url = new URL(video.url);
  if (!url.hash) url.hash = `openparty=${partyId}@${host}`;
  return url.href;
}

const STORE_URL = "https://chromewebstore.google.com/detail/openparty/kadbnppelahhppgpaaipkjogpjeddcmb";

const STYLE = `
  :root { color-scheme: light dark; --bg:#f7f7fb; --fg:#16161d; --muted:#5b5b6b; --card:#fff; --accent:#5b4bff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111116; --fg:#ececf3; --muted:#a0a0b2; --card:#1b1b23; --accent:#8b7dff; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:30rem; margin:1rem; padding:2rem; background:var(--card); border-radius:16px; box-shadow:0 4px 24px #0002; }
  h1 { margin:0 0 .25rem; font-size:1.4rem; } p { color:var(--muted); }
  .title { color:var(--fg); font-weight:600; word-break:break-word; }
  code { font-size:1.3rem; letter-spacing:.08em; padding:.2rem .5rem; border-radius:8px; background:var(--bg); }
  a.btn { display:inline-block; margin-top:1rem; padding:.7rem 1.2rem; border-radius:10px; background:var(--accent);
          color:#fff; text-decoration:none; font-weight:600; }
  ol { color:var(--muted); padding-left:1.2rem; } ol a { color:var(--accent); }
`;

function page(title, body, mainAttrs = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main${mainAttrs}>${body}</main></body></html>`;
}

export function invitePage(room, host) {
  if (!room || !room.hostId || !room.video) {
    return page("OpenParty", `<h1>Party not found</h1><p>This party has ended or the link is wrong.</p>`);
  }
  const link = inviteLink(room.video, room.id, host);
  // The extension's invite script reads these attributes and takes over (one-click join).
  const data =
    ` id="openparty-invite" data-party-id="${escapeHtml(room.id)}"` +
    ` data-video-url="${escapeHtml(room.video.url)}" data-video-title="${escapeHtml(room.video.title)}"`;
  return page(
    "Join my OpenParty",
    `<h1>You're invited to a watch party</h1>
<p class="title">${escapeHtml(room.video.title)}</p>
<p>Have OpenParty installed? You'll be taken into the party automatically.</p>
<ol>
  <li>Install the free <a href="${STORE_URL}" rel="noreferrer">OpenParty extension</a>, then open this link again.</li>
  <li>Or open the video with the button below, click the OpenParty icon and press <b>Join</b>.
      Party code: <code>${escapeHtml(room.id)}</code></li>
</ol>
<a class="btn" href="${escapeHtml(link)}" rel="noreferrer">Open the video</a>`,
    data,
  );
}

export function infoPage() {
  return page(
    "OpenParty server",
    `<h1>OpenParty server</h1><p>This is a sync server for OpenParty, the free and open-source watch-party extension.
It relays playback state and chat between party members and keeps nothing once a party ends.</p>`,
  );
}

export const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

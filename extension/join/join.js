// Shown when an invite link is opened with OpenParty installed. Joins the
// party and opens the video in this tab; asks for access to the video's site
// first if OpenParty doesn't have it yet.

const $ = (id) => document.getElementById(id);
const bg = (op, data = {}) => chrome.runtime.sendMessage({ op, ...data });

let tab = null;
let invite = null;

function fail(text) {
  $("error").textContent = text;
  $("error").hidden = false;
  $("status").textContent = "";
  $("join").disabled = false;
}

async function go() {
  $("join").disabled = true;
  $("error").hidden = true;
  $("status").textContent = "Joining…";
  const name = $("name").value.trim().slice(0, 24);
  if (name) await chrome.storage.local.set({ name });
  const res = await bg("join", { tabId: tab.id, code: invite.partyId, serverUrl: invite.serverUrl });
  if (res && res.error) return fail(res.error);
  $("status").textContent = "Opening the video…";
  const nav = await bg("navigate", { tabId: tab.id, url: res.video.url });
  if (nav && nav.error) fail(nav.error);
}

$("join").addEventListener("click", () => {
  // The one-time site-access prompt (needs this click). Join either way:
  // without access the popup's "Reconnect" can still attach to the page.
  OPU.requestAllSites().then(go);
});

$("avatar").addEventListener("click", async () => {
  const i = OPU.AVATARS.indexOf($("avatar").textContent);
  const avatar = OPU.AVATARS[(i + 1) % OPU.AVATARS.length];
  $("avatar").textContent = avatar;
  await chrome.storage.local.set({ avatar });
});

(async () => {
  tab = await chrome.tabs.getCurrent();
  invite = await bg("pending-invite", { tabId: tab.id });
  const settings = await OPU.getSettings();
  $("name").value = settings.name;
  $("avatar").textContent = settings.avatar;
  if (!invite) {
    $("join").disabled = true;
    return fail("This invite has expired. Open the invite link again.");
  }
  $("video-title").textContent = invite.video.title || "A video";
  const site = new URL(invite.video.url).hostname.replace(/^www\./, "");
  $("site").textContent = `on ${site}. Make sure you can watch it there (signed in, subscription if needed).`;
  const pattern = OPU.originPattern(invite.video.url);
  const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  if (granted) return go(); // access already given: straight in, like a normal link
  $("status").textContent =
    "First time only: OpenParty will ask for access to websites so it can sync videos. " +
    "It only runs on a page while that tab is in a party.";
  $("join").focus();
})();

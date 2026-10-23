const $ = (id) => document.getElementById(id);

let tab = null;
let probe = null;
let status = null;

const bg = (op, data = {}) => chrome.runtime.sendMessage({ op, tabId: tab && tab.id, ...data });

function showError(text) {
  $("error").textContent = text || "";
  $("error").hidden = !text;
}

// Must be called synchronously from a click handler: Chrome only shows the
// permission prompt during a user gesture. Resolves to whether access was granted.
function requestAccess(urls) {
  const origins = [...new Set(urls.map((u) => OPU.originPattern(u)).filter(Boolean))];
  if (origins.length === 0) return Promise.resolve(false);
  return chrome.permissions.request({ origins }).catch(() => false);
}

// Run an action with the popup's buttons disabled, showing any error.
async function run(action) {
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  showError("");
  try {
    await action();
  } catch (e) {
    showError(typeof e === "string" ? e : (e && e.message) || "Something went wrong.");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    if (!$("start-view").hidden && probe && probe.error) $("start").disabled = true;
  }
}

async function render() {
  status = await bg("status");
  $("party-view").hidden = !status.inParty;
  $("start-view").hidden = status.inParty;
  $("badge").hidden = !status.inParty;
  $("badge").textContent = "In a party";
  if (status.inParty) renderParty();
  else await renderStart();
}

async function renderStart() {
  probe = await bg("probe");
  const invite = OPU.parseInvite(tab.url || "");
  if (invite && !$("join-code").value) {
    $("join-code").value = invite.host ? `${invite.partyId}@${invite.host}` : invite.partyId;
  }
  const hint = $("video-hint");
  $("start").disabled = !!probe.error;
  if (probe.error) hint.textContent = "Open a page with a video to start a party. You can still join one below.";
  else if (invite) hint.textContent = "You were invited to this party. Press Join below.";
  else if (probe.hasVideo) hint.textContent = "Video found on this page. Start a party and share the link.";
  else if (probe.iframeOrigins.length) hint.textContent = "This page embeds a video player. Start a party and allow access when asked.";
  else hint.textContent = "No video found yet. Start playing it first, or start the party anyway.";
  if (invite) $("join").focus();
}

function renderParty() {
  $("party-code").textContent = status.partyId;
  $("party-status").textContent =
    status.status === "connected"
      ? `${status.users.length} watching`
      : status.status === "reconnecting"
        ? "reconnecting…"
        : "connecting…";
  $("invite-url").value = status.inviteUrl;
  $("party-video").textContent = status.video ? `Watching: ${status.video.title}` : "";
  const elsewhere = !!status.video && OPU.videoKey(tab.url || "") !== OPU.videoKey(status.video.url);
  $("go-video").hidden = !elsewhere;
  $("reconnect").hidden = !status.needsReconnect || elsewhere;
  const members = $("members");
  members.replaceChildren();
  for (const u of status.users) {
    const li = document.createElement("li");
    li.textContent = `${u.avatar} ${u.name}${u.host ? " 👑" : ""}`;
    members.append(li);
  }
  $("lock-row").hidden = !status.isHost;
  $("lock").checked = !!status.controlLock;
}

// ---- actions ----

$("start").addEventListener("click", () => {
  const access = requestAccess([tab.url, ...((probe && probe.iframeOrigins) || [])]);
  run(async () => {
    await access;
    const res = await bg("start", { controlLock: $("control-lock").checked });
    if (res.error) throw res.error;
    await render();
    bg("show-panel");
  });
});

$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const access = requestAccess([tab.url || ""]);
  run(async () => {
    await access;
    const res = await bg("join", { code: $("join-code").value });
    if (res.error) throw res.error;
    await render();
    if (res.sameVideo) bg("show-panel");
  });
});

$("go-video").addEventListener("click", () => {
  const url = status.video.url;
  const access = requestAccess([url]);
  run(async () => {
    await access;
    const res = await bg("navigate", { url });
    if (res.error) throw res.error;
    window.close();
  });
});

$("reconnect").addEventListener("click", () => {
  const access = requestAccess([tab.url || ""]);
  run(async () => {
    await access;
    const res = await bg("reconnect");
    if (res.error) throw res.error;
    await render();
  });
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("invite-url").value);
  $("copy").textContent = "Copied!";
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

$("show-panel").addEventListener("click", async () => {
  await bg("show-panel");
  window.close();
});

let leaveArmed = null;
$("leave").addEventListener("click", () => {
  if (!leaveArmed) {
    $("leave").textContent = "Click again to leave";
    leaveArmed = setTimeout(() => {
      leaveArmed = null;
      $("leave").textContent = "Leave party";
    }, 3000);
    return;
  }
  clearTimeout(leaveArmed);
  leaveArmed = null;
  run(async () => {
    await bg("leave");
    $("leave").textContent = "Leave party";
    await render();
  });
});

$("lock").addEventListener("change", () =>
  run(async () => {
    const res = await bg("lock", { on: $("lock").checked });
    if (res.error) throw res.error;
  }),
);

// ---- profile ----

async function loadProfile() {
  const settings = await OPU.getSettings();
  $("name").value = settings.name;
  $("avatar").textContent = settings.avatar;
}

$("avatar").addEventListener("click", async () => {
  const i = OPU.AVATARS.indexOf($("avatar").textContent);
  const avatar = OPU.AVATARS[(i + 1) % OPU.AVATARS.length];
  $("avatar").textContent = avatar;
  await chrome.storage.local.set({ avatar });
  bg("profile-changed");
});

$("name").addEventListener("change", async () => {
  const name = $("name").value.trim().slice(0, 24);
  if (!name) return loadProfile();
  await chrome.storage.local.set({ name });
  bg("profile-changed");
});

$("settings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadProfile();
  await render();
})();

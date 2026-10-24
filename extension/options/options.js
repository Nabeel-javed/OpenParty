const $ = (id) => document.getElementById(id);

function result(text, ok) {
  const el = $("server-result");
  el.textContent = text;
  el.className = ok === undefined ? "hint" : ok ? "ok" : "bad";
}

// WebSockets aren't subject to CORS, so this works without extra permissions.
function testServer(serverUrl) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(OPU.wsUrl(serverUrl, OPU.newPartyId()));
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

async function load() {
  const settings = await OPU.getSettings();
  $("name").value = settings.name;
  $("avatar").textContent = settings.avatar;
  $("server").value = settings.serverUrl;
  await showSites();
}

async function showSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  if (origins.includes("<all_urls>")) $("sites").textContent = "Allowed on all sites.";
  else if (origins.length === 0) $("sites").textContent = "No sites allowed yet.";
  else $("sites").textContent = "Allowed on: " + origins.map((o) => o.replace(/^\w+:\/\/|\/\*$/g, "")).join(", ");
}

$("avatar").addEventListener("click", async () => {
  const i = OPU.AVATARS.indexOf($("avatar").textContent);
  const avatar = OPU.AVATARS[(i + 1) % OPU.AVATARS.length];
  $("avatar").textContent = avatar;
  await chrome.storage.local.set({ avatar });
  chrome.runtime.sendMessage({ op: "profile-changed" });
});

$("name").addEventListener("change", async () => {
  const name = $("name").value.trim().slice(0, 24);
  if (!name) return load();
  await chrome.storage.local.set({ name });
  chrome.runtime.sendMessage({ op: "profile-changed" });
});

$("test").addEventListener("click", async () => {
  const url = OPU.normalizeServerUrl($("server").value);
  if (!url) return result("That isn't a valid http(s) address.", false);
  result("Testing…");
  const ok = await testServer(url);
  result(ok ? "Server is reachable." : "Can't reach that server.", ok);
});

$("save-server").addEventListener("click", async () => {
  const url = OPU.normalizeServerUrl($("server").value);
  if (!url) return result("That isn't a valid http(s) address.", false);
  // Saving the default stores nothing, so a later change of default still applies.
  if (url === OPU.DEFAULT_SERVER_URL) await chrome.storage.local.remove("serverUrl");
  else await chrome.storage.local.set({ serverUrl: url });
  $("server").value = url;
  result("Saved. New parties will use this server.", true);
});

$("reset-server").addEventListener("click", async () => {
  await chrome.storage.local.remove("serverUrl");
  $("server").value = OPU.DEFAULT_SERVER_URL;
  result("Using the default server.", true);
});

$("all-sites").addEventListener("click", async () => {
  await chrome.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
  showSites();
});

$("clear-sites").addEventListener("click", async () => {
  const { origins = [] } = await chrome.permissions.getAll();
  if (origins.length) await chrome.permissions.remove({ origins }).catch(() => false);
  showSites();
});

load();

// Runs on OpenParty invite pages (<server>/j/<code>). Hands the invite to the
// service worker, which opens OpenParty's join page in this tab.
(() => {
  const el = document.getElementById("openparty-invite");
  if (!el || !el.dataset.partyId) return;
  chrome.runtime.sendMessage({
    op: "invite-open",
    partyId: el.dataset.partyId,
    serverUrl: location.origin,
    video: { url: el.dataset.videoUrl, title: el.dataset.videoTitle },
  });
})();

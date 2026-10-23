// Runs in Netflix's page world. Receives play/pause/seek commands from the
// OpenParty content script (same window, same origin) and forwards them to
// Netflix's player API.
(() => {
  if (window.__openpartyNetflix) return;
  window.__openpartyNetflix = true;

  function currentPlayer() {
    try {
      const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const sessions = videoPlayer.getAllPlayerSessionIds();
      const session = sessions.find((id) => id.startsWith("watch")) || sessions[0];
      return session ? videoPlayer.getVideoPlayerBySessionId(session) : null;
    } catch {
      return null;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.openparty !== "netflix") return;
    const player = currentPlayer();
    if (!player) return;
    const { cmd, ms } = event.data;
    if (cmd === "play") player.play();
    else if (cmd === "pause") player.pause();
    else if (cmd === "seek" && Number.isFinite(ms)) player.seek(Math.max(0, ms));
  });
})();

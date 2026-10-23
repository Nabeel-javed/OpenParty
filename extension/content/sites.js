// Per-site tweaks. Every field is optional; any site not listed here is
// synced through its plain <video> element, which covers most players.
//
//   host     RegExp matched against location.hostname
//   adapter  "html5" (default) or a key of OP.adapters for sites whose player
//            must be driven through its own API
//   video    CSS selector for the main <video> when the biggest one is wrong
//   ad       CSS selector that is present and visible only while an ad plays;
//            sync pauses for you while it matches
//
// See CONTRIBUTING.md for how to add a site.
(() => {
  const OP = globalThis.OP;
  if (OP.sites) return;

  OP.sites = [
    { id: "netflix", host: /(^|\.)netflix\.com$/, adapter: "netflix" },
    {
      id: "youtube",
      host: /(^|\.)youtube\.com$/,
      video: "#movie_player video, #shorts-player video",
      ad: "#movie_player.ad-showing",
    },
    { id: "hulu", host: /(^|\.)hulu\.com$/, ad: ".AdUnitView__adBar__badge" },
    { id: "max", host: /(^|\.)(max|hbomax)\.com$/, ad: '[data-testid="player-ux-ad-label"]' },
    { id: "crunchyroll", host: /(^|\.)crunchyroll\.com$/, ad: 'video[title="Advertisement"]' },
    { id: "viki", host: /(^|\.)viki\.com$/, ad: 'video[title="Advertisement"]' },
  ];

  OP.siteFor = (hostname) => OP.sites.find((s) => s.host.test(hostname)) || { id: "generic" };

  OP.adVisible = (selector) => {
    if (!selector) return false;
    const el = document.querySelector(selector);
    return !!el && el.getClientRects().length > 0;
  };
})();

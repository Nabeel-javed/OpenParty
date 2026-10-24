# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste.

## Store listing

- **Description:** [description.txt](description.txt)
- **Category:** Entertainment
- **Language:** English
- **Homepage URL:** https://github.com/Nabeel-javed/OpenParty
- **Support URL:** https://github.com/Nabeel-javed/OpenParty/issues
- **Mature content:** No

## Privacy

**Single purpose**

> OpenParty synchronizes video playback between friends watching the same video on any website, with chat and reactions next to the video.

**Permission justifications**

- `storage`: Saves the user's display name, avatar and chosen sync server, and remembers which tabs are in a party so the party survives page reloads.
- `scripting`: Injects OpenParty's sync engine and party panel into a tab only after the user starts or joins a party in that tab, so it can keep that page's video in sync and show chat.
- `activeTab`: When the user clicks the OpenParty icon, checks the current tab for a video before starting a party there.
- **Host permissions:** Optional access to all sites is requested once, when the user first starts or joins a party, because the video can be on any website. It is used only in tabs that are in a party, to keep the party connected through page reloads and when the host moves to the next episode. The content script on openparty.openparty-worker.workers.dev/j/* only reads our own invite page so friends can join in one click.

**Remote code:** No, I am not using remote code.

**Data usage:** tick *Personal communications* (chat messages) and *Web history* (the address and title of the video page in a party). Nothing else. Tick all three certifications.

**Privacy policy URL:** https://github.com/Nabeel-javed/OpenParty/blob/main/PRIVACY.md

## Distribution

Free, Public, all regions.

## Test instructions (for the reviewer)

> No account or login needed. 1) Open any page with a video, e.g. a YouTube video. 2) Click the OpenParty icon, press "Start a party" and allow site access when asked. 3) Open the copied invite link in a second Chrome profile that also has OpenParty, and you land in the party on the same video. Play, pause or seek in one window and the other follows. The 🍿 button opens chat and reactions.

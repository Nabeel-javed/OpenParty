// The party panel shown in the top frame: chat, members, reactions and party
// controls. Lives in a closed shadow root; all user text goes in via textContent.
(() => {
  const OP = globalThis.OP;
  if (OP.ui) return;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #ececf3; }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
    .fab { position: relative; width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(160deg, #7c5cff, #4f38e6); box-shadow: 0 6px 20px #0007;
      display: grid; place-items: center; font-size: 22px; }
    .fab-count { position: absolute; bottom: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px;
      border-radius: 10px; background: #16161d; border: 2px solid #7c5cff; font-size: 11px; font-weight: 700;
      display: grid; place-items: center; }
    .fab-dot { position: absolute; top: 0; right: 0; width: 12px; height: 12px; border-radius: 50%;
      background: #ff4d6d; border: 2px solid #16161d; }
    .panel { position: fixed; right: 16px; bottom: 76px; width: 320px; height: min(520px, calc(100vh - 110px));
      display: flex; flex-direction: column; background: rgba(22, 22, 30, 0.95); border: 1px solid #ffffff1a;
      border-radius: 14px; box-shadow: 0 12px 40px #000a; backdrop-filter: blur(10px); overflow: hidden; }
    [hidden] { display: none !important; }
    header { padding: 10px 10px 8px 12px; border-bottom: 1px solid #ffffff14; }
    .top { display: flex; align-items: center; gap: 8px; }
    .status { width: 8px; height: 8px; border-radius: 50%; background: #f5a524; flex: none; }
    .status.ok { background: #2bd576; }
    .title { flex: 1; min-width: 0; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; gap: 2px; }
    .actions button { width: 28px; height: 28px; border-radius: 8px; font-size: 14px; }
    .actions button:hover { background: #ffffff14; }
    .actions button.on { background: #7c5cff33; }
    .actions button.warn { background: #ff4d6d; color: #fff; width: auto; padding: 0 8px; font-size: 12px; }
    .actions button:disabled { opacity: .35; cursor: default; }
    .users { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .user { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 4px; border-radius: 12px;
      background: #ffffff10; font-size: 12px; max-width: 140px; }
    .user .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user.me { outline: 1px solid #7c5cff88; }
    .log { flex: 1; overflow-y: auto; margin: 0; padding: 8px 10px; list-style: none; display: flex;
      flex-direction: column; gap: 6px; scrollbar-width: thin; }
    .msg { display: flex; gap: 8px; }
    .msg .av { font-size: 18px; line-height: 1.2; }
    .msg .who { font-weight: 650; font-size: 12px; color: #b9b3ff; }
    .msg .text { white-space: pre-wrap; word-break: break-word; }
    .sys { color: #a0a0b2; font-size: 12px; text-align: center; }
    .sys button { color: #b9b3ff; text-decoration: underline; padding: 0 2px; }
    .typing { min-height: 18px; padding: 0 12px; font-size: 11px; color: #a0a0b2; }
    .reactions { display: flex; justify-content: space-between; padding: 4px 8px; border-top: 1px solid #ffffff14; }
    .reactions button { font-size: 18px; width: 32px; height: 32px; border-radius: 8px; }
    .reactions button:hover { background: #ffffff14; transform: scale(1.1); }
    form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #ffffff14; }
    textarea { flex: 1; resize: none; height: 36px; padding: 8px 10px; border-radius: 10px; border: 1px solid #ffffff1f;
      background: #0e0e14; color: #ececf3; font: inherit; outline: none; }
    textarea:focus { border-color: #7c5cff; }
    form button { padding: 0 12px; border-radius: 10px; background: #5b4bff; font-weight: 650; }
    form button:disabled, textarea:disabled { opacity: .5; }
    form .emoji-toggle { padding: 0 4px; background: none; font-size: 20px; font-weight: 400; border-radius: 8px; }
    form .emoji-toggle:hover, form .emoji-toggle.on { background: #ffffff14; }
    .picker { position: absolute; left: 8px; right: 8px; bottom: 56px; height: 260px; display: flex; flex-direction: column;
      border-radius: 12px; background: #1d1d27; border: 1px solid #ffffff1f; box-shadow: 0 8px 24px #0009; overflow: hidden; }
    .picker .tabs { display: flex; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid #ffffff14; }
    .picker .tabs button { width: 32px; height: 28px; border-radius: 8px; font-size: 16px; opacity: .7; }
    .picker .tabs button:hover { background: #ffffff14; opacity: 1; }
    .picker .groups { position: relative; flex: 1; overflow-y: auto; padding: 0 6px 6px; scrollbar-width: thin; }
    .picker h3 { margin: 8px 4px 2px; font-size: 11px; font-weight: 600; color: #a0a0b2; }
    .picker .grid { display: grid; grid-template-columns: repeat(8, 1fr); }
    .picker .grid button { height: 32px; border-radius: 8px; font-size: 20px; line-height: 1; }
    .picker .grid button:hover { background: #ffffff14; }
    .toast { position: absolute; left: 12px; right: 12px; bottom: 60px; padding: 8px 10px; border-radius: 10px;
      background: #2b2b38; border: 1px solid #ffffff1f; font-size: 12px; text-align: center; }
    .float { position: fixed; bottom: 90px; font-size: 32px; pointer-events: none;
      animation: rise 2.6s ease-out forwards; }
    @keyframes rise { 0% { transform: translateY(0) scale(.6); opacity: 0; } 15% { opacity: 1; transform: translateY(-30px) scale(1.1); }
      100% { transform: translateY(-320px) scale(1); opacity: 0; } }
    .standalone { position: fixed; right: 16px; bottom: 16px; padding: 10px 14px; border-radius: 12px;
      background: #2b2b38; box-shadow: 0 6px 20px #0008; }
  `;

  // The chat box's emoji picker: the common set, grouped like phone keyboards.
  // Emoji 13.1 and older only, so nothing shows up as an empty box on older
  // systems (Windows 10, older macOS).
  const EMOJI_GROUPS = [
    ["😀", "Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊"],
    ["👋", "People", "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋 🙋 🙆 🙅 🤷 🤦 🙇 💁 🕺 💃 🏃 🚶 🧘 🛌 👶 🧒 👧 👦 🧑 👩 👨 🧓 👵 👴 👮 🕵️ 👷 🤴 👸 🦸 🦹 🧙 🧛 🧟 🧞 🧜 🧚 👼 🎅 🤶 👫 👭 👬 💏 💑 👪"],
    ["❤️", "Hearts & symbols", "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 💬 💭 💤 ✅ ❌ ❓ ❗ ‼️ ⁉️ ⚠️ 🚫 ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🆗 🆒 🆕 🆙 🔞 ♻️ ➕ ➖ ✖️ ➗ 🔝 🔜 ▶️ ⏸️ ⏯️ ⏹️ ⏭️ ⏮️ ⏩ ⏪ 🔁 🔀 🔊 🔇 🎵 🎶 ✔️ 🔔 🔕"],
    ["🐶", "Animals & nature", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐄 🐎 🐖 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🦚 🦜 🦢 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 🌊 💧 🌍"],
    ["🍔", "Food & drink", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥜 🍯 🥛 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🧊"],
    ["⚽", "Activities", "🎉 🎊 🎈 🎁 🎀 🎃 🎆 🎇 🧨 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🎣 🎿 🛹 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎰 🎬 🎥 📺 📽️ 🎞️ 📷 📸 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎭 🎨 🧸 🪄"],
    ["🚗", "Travel & objects", "🚗 🚕 🚌 🏎️ 🚓 🚑 🚒 🚲 🛵 🏍️ ✈️ 🚀 🛸 🚁 ⛵ 🚢 🗽 🗼 🏰 🏯 🎡 🎢 🏖️ 🏝️ 🏔️ 🌋 🏠 🏙️ 🌃 🌆 🌉 📱 💻 🖥️ ⌨️ 💡 🔦 📚 📖 ✏️ 📝 📌 📎 🔒 🔓 🔑 🔨 💣 🛡️ 💊 💉 💰 💵 💎 ⏰ ⌛ 📅 🛒 🎒 👓 🕶️ 👑 💍 👟 👗 👕 🧢"],
  ].map(([icon, name, list]) => ({ icon, name, list: list.split(" ") }));

  // Built with DOM calls, not innerHTML: some sites enforce Trusted Types.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "class") el.className = value;
      else if (key === "hidden") el.hidden = !!value;
      else el.setAttribute(key, value);
    }
    el.append(...children);
    return el;
  }

  function buildRoot() {
    const action = (act, label, title) => h("button", { "data-act": act, title, "aria-label": title }, label);
    return h(
      "div",
      { class: "root" },
      h(
        "section",
        { class: "panel", hidden: true },
        h(
          "header",
          {},
          h(
            "div",
            { class: "top" },
            h("span", { class: "status", title: "Connecting" }),
            h("span", { class: "title" }, "OpenParty"),
            h(
              "div",
              { class: "actions" },
              action("invite", "🔗", "Copy invite link"),
              action("lock", "🔓", "Toggle host-only control"),
              action("min", "▾", "Hide panel"),
              action("leave", "✕", "Leave party"),
            ),
          ),
          h("div", { class: "users" }),
        ),
        h("ol", { class: "log", "aria-live": "polite" }),
        h("div", { class: "typing" }),
        h("div", { class: "reactions" }),
        h(
          "div",
          { class: "picker", hidden: true, role: "dialog", "aria-label": "Emoji" },
          h("div", { class: "tabs" }, ...EMOJI_GROUPS.map((g, i) => h("button", { type: "button", "data-group": i, title: g.name, "aria-label": g.name }, g.icon))),
          h("div", { class: "groups" }),
        ),
        h(
          "form",
          {},
          h("button", { type: "button", class: "emoji-toggle", title: "Emoji", "aria-label": "Insert emoji" }, "😊"),
          h("textarea", { maxlength: "500", placeholder: "Say something…", "aria-label": "Chat message" }),
          h("button", { type: "submit" }, "Send"),
        ),
        h("div", { class: "toast", hidden: true }),
      ),
      h(
        "button",
        { class: "fab", title: "OpenParty", "aria-label": "Open party panel" },
        "🍿",
        h("span", { class: "fab-count" }, "1"),
        h("span", { class: "fab-dot", hidden: true }),
      ),
    );
  }

  const PANEL_EVENTS = ["keydown", "keyup", "keypress", "pointerdown", "pointerup", "mousedown", "mouseup", "click",
    "touchstart", "touchend", "wheel", "focusin", "focusout"];

  // Focus moving from the page into the panel also fires focusout on the page's
  // element, and focus traps may listen in the capture phase: hide both from the
  // page before its own listeners run.
  let focusGuarded = false;
  function guardFocus(host) {
    if (focusGuarded) return;
    focusGuarded = true;
    const intoPanel = (node) => !!node && node === host();
    addEventListener("focusout", (e) => intoPanel(e.relatedTarget) && e.stopImmediatePropagation(), true);
    addEventListener("focusin", (e) => intoPanel(e.target) && e.stopImmediatePropagation(), true);
  }

  class Panel {
    constructor() {
      this.host = null;
      this.room = null;
      this.users = [];
      this.isHost = false;
      this.unread = 0;
      this.typingOn = false;
      this.typingTimer = null;
      this.leaveArmed = null;
      this.lastStatus = "connected";
    }

    mount() {
      if (this.host) return this.ensureAttached();
      this.host = document.createElement("openparty-panel");
      const shadow = this.host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      shadow.append(style, buildRoot());
      this.$ = (sel) => shadow.querySelector(sel);
      this.root = this.$(".root");

      // What happens in the panel stays out of the page: site shortcuts (space =
      // pause), click-outside handlers, and focus traps of modal players that pull
      // focus straight back out of the chat box. The page sees these events
      // retargeted to the host element.
      for (const type of PANEL_EVENTS) this.host.addEventListener(type, (e) => e.stopPropagation());
      guardFocus(() => this.host);

      this.$(".fab").addEventListener("click", () => this.open(this.$(".panel").hidden));
      this.$(".actions").addEventListener("click", (e) => this.onAction(e.target.closest("button")));
      for (const emoji of OPU.REACTIONS) {
        const b = document.createElement("button");
        b.textContent = emoji;
        b.title = "React " + emoji;
        b.addEventListener("click", () => OP.send({ op: "react", emoji }));
        this.$(".reactions").append(b);
      }
      const input = this.$("textarea");
      // A page may cancel the mousedown that would focus the box; focus it ourselves.
      input.addEventListener("click", () => shadow.activeElement !== input && input.focus());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.submit();
        }
      });
      input.addEventListener("input", () => this.onTyping());

      // Emoji picker: picks go in at the cursor; it stays open for more until
      // Escape, a click elsewhere, or sending.
      const picker = this.$(".picker");
      const toggle = this.$(".emoji-toggle");
      const groups = this.$(".picker .groups");
      this.showPicker = (on) => {
        // Hundreds of buttons: build them the first time they're needed.
        if (on && !groups.firstChild) {
          for (const g of EMOJI_GROUPS) {
            const grid = h("div", { class: "grid" }, ...g.list.map((e) => h("button", { type: "button", "data-emoji": e, title: e, "aria-label": e }, e)));
            groups.append(h("h3", {}, g.name), grid);
          }
        }
        picker.hidden = !on;
        toggle.classList.toggle("on", on);
      };
      toggle.addEventListener("click", () => {
        this.showPicker(picker.hidden);
        input.focus();
      });
      picker.addEventListener("click", (e) => {
        const button = e.target.closest("button[data-emoji]");
        if (button) return this.insertText(button.dataset.emoji);
        const tab = e.target.closest("button[data-group]");
        if (tab) groups.scrollTop = groups.querySelectorAll("h3")[Number(tab.dataset.group)].offsetTop - 4;
      });
      shadow.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !picker.hidden) {
          this.showPicker(false);
          input.focus();
        }
      });
      shadow.addEventListener("click", (e) => {
        if (!picker.hidden && !picker.contains(e.target) && !toggle.contains(e.target)) this.showPicker(false);
      });
      // Clicks on the page itself (they reach the document retargeted to the host when they're ours).
      document.addEventListener("click", (e) => this.host && e.target !== this.host && this.showPicker(false), true);
      this.$("form").addEventListener("submit", (e) => {
        e.preventDefault();
        this.submit();
      });
      this.onFullscreen = () => this.ensureAttached(true);
      document.addEventListener("fullscreenchange", this.onFullscreen);
      this.ensureAttached();
    }

    // In fullscreen the panel must live inside the fullscreen element to stay visible.
    ensureAttached(force) {
      if (!this.host) return;
      const fs = document.fullscreenElement;
      const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
      if (force || !this.host.isConnected || this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    unmount(message) {
      if (!this.host) return;
      document.removeEventListener("fullscreenchange", this.onFullscreen);
      const host = this.host;
      this.host = null;
      this.room = null;
      if (!message) return host.remove();
      // Leave a short note where the panel was.
      this.root.replaceChildren(Object.assign(document.createElement("div"), { className: "standalone", textContent: message }));
      setTimeout(() => host.remove(), 5000);
    }

    open(show) {
      this.$(".panel").hidden = !show;
      if (!show) this.showPicker(false);
      if (show) {
        this.unread = 0;
        this.$(".fab-dot").hidden = true;
        this.scrollLog();
      }
    }

    // ---- messages from the service worker ----

    handle(msg) {
      if (msg.op === "room") return this.setRoom(msg.room, msg.first);
      if (msg.op === "show-panel") return this.open(true);
      if (msg.op === "ui" && this.room) this.onEvent(msg.kind, msg.data || {});
    }

    setRoom(room, first) {
      this.mount();
      const fresh = !this.room;
      this.room = room;
      this.isHost = room.isHost;
      this.setUsers(room.users);
      this.setTitle(room.video && room.video.title);
      this.setLock(room.controlLock);
      this.setStatus(room.status || "connected");
      if (fresh) {
        this.$(".log").replaceChildren();
        for (const m of room.messages || []) this.addChat(m, true);
        if (first) {
          this.system(this.isHost ? "Party started. Share the invite link (🔗) with friends." : "You joined the party.");
          if (!this.isHost && room.video && OPU.videoKey(location.href) !== OPU.videoKey(room.video.url)) this.notHere(room.video);
          this.open(true);
        }
      }
    }

    onEvent(kind, data) {
      switch (kind) {
        case "chat":
          this.addChat(data);
          if (this.$(".panel").hidden && data.from !== this.room.me) {
            this.unread++;
            this.$(".fab-dot").hidden = false;
          }
          break;
        case "users":
          this.isHost = data.isHost;
          this.room.isHost = data.isHost;
          this.setUsers(data.users);
          break;
        case "react":
          this.floatEmoji(data.emoji);
          break;
        case "notice":
          this.notice(data);
          break;
        case "state":
          this.stateNotice(data);
          break;
        case "lock":
          this.setLock(data.on);
          break;
        case "video":
          this.videoChanged(data);
          break;
        case "status":
          this.setStatus(data.status);
          break;
        case "local":
          if (data.kind === "locked") this.toast("Only the host can control playback right now.");
          break;
        case "ended":
          this.system(`Party ended: ${data.reason}`);
          break;
        case "error":
          this.toast(data.message || "Something went wrong.");
          break;
      }
    }

    // ---- rendering ----

    setTitle(title) {
      this.$(".title").textContent = title || "OpenParty";
      this.$(".title").title = title || "";
    }

    setStatus(status) {
      const dot = this.$(".status");
      dot.classList.toggle("ok", status === "connected");
      dot.title = status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : "Connecting…";
      if (status === "reconnecting" && this.lastStatus === "connected") this.system("Connection lost. Reconnecting…");
      if (status === "connected" && this.lastStatus === "reconnecting") this.system("Reconnected.");
      this.lastStatus = status;
    }

    setUsers(users) {
      this.users = users || [];
      this.room.users = this.users;
      const list = this.$(".users");
      list.replaceChildren();
      for (const u of this.users) {
        const chip = document.createElement("span");
        chip.className = "user" + (u.id === this.room.me ? " me" : "");
        const marks = [u.host ? "👑" : "", u.buffering ? "⏳" : "", u.ads ? "📺" : ""].join("");
        chip.title = `${u.name}${u.host ? " (host)" : ""}${u.buffering ? ", buffering" : ""}${u.ads ? ", watching an ad" : ""}`;
        const av = document.createElement("span");
        av.textContent = u.avatar;
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = u.name + (marks ? " " + marks : "");
        chip.append(av, name);
        list.append(chip);
      }
      this.$(".fab-count").textContent = String(this.users.length);
      const typing = this.users.filter((u) => u.typing && u.id !== this.room.me).map((u) => u.name);
      this.$(".typing").textContent = typing.length ? `${typing.slice(0, 3).join(", ")} ${typing.length > 1 ? "are" : "is"} typing…` : "";
      const lock = this.$('[data-act="lock"]');
      lock.disabled = !this.isHost;
    }

    setLock(on) {
      this.room.controlLock = on;
      const lock = this.$('[data-act="lock"]');
      lock.textContent = on ? "🔒" : "🔓";
      lock.classList.toggle("on", on);
      lock.title = on ? "Only the host controls playback (click to allow everyone)" : "Everyone controls playback (click to lock to host)";
    }

    nameOf(id) {
      const u = this.users.find((x) => x.id === id);
      return u ? u.name : "Someone";
    }

    addChat(m, bulk) {
      const li = document.createElement("li");
      li.className = "msg";
      const av = document.createElement("span");
      av.className = "av";
      av.textContent = m.avatar || "🙂";
      const body = document.createElement("div");
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = m.from === this.room.me ? `${m.name} (you)` : m.name;
      const text = document.createElement("div");
      text.className = "text";
      text.textContent = m.text;
      body.append(who, text);
      li.append(av, body);
      this.append(li, bulk);
    }

    system(text, extra) {
      const li = document.createElement("li");
      li.className = "sys";
      li.textContent = text;
      if (extra) li.append(" ", extra);
      this.append(li);
      return li;
    }

    append(li, bulk) {
      const log = this.$(".log");
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      log.append(li);
      while (log.children.length > 200) log.firstChild.remove();
      if (!bulk && nearBottom) this.scrollLog();
    }

    scrollLog() {
      const log = this.$(".log");
      log.scrollTop = log.scrollHeight;
    }

    notice(d) {
      if (d.kind === "join") this.system(`${d.name} joined.`);
      else if (d.kind === "leave") this.system(`${d.name} left.`);
      else if (d.kind === "host") this.system(`${d.name} is now the host.`);
      else if (d.kind === "lock") this.system(d.on ? `${d.name} locked playback to the host.` : `${d.name} let everyone control playback.`);
    }

    stateNotice(d) {
      if (d.by === this.room.me) {
        this.room.playback = d;
        return;
      }
      const prev = this.room.playback || {};
      const who = this.nameOf(d.by);
      if (prev.state !== d.state) this.system(d.state === "paused" ? `${who} paused at ${OP.formatTime(d.timeMs)}.` : `${who} pressed play.`);
      else this.system(`${who} jumped to ${OP.formatTime(d.timeMs)}.`);
      this.room.playback = d;
    }

    // A guest whose page isn't the party's video (some sites redirect, or keep
    // the video out of the address): they can still find it themselves.
    notHere(video) {
      const go = document.createElement("button");
      go.textContent = "Open it";
      go.addEventListener("click", () => location.assign(video.url));
      this.system(`The party is watching “${video.title || video.url}”. Open it in this tab and you'll sync as soon as it plays.`, go);
    }

    videoChanged(d) {
      this.room.video = d;
      this.setTitle(d.title);
      if (d.by === this.room.me) {
        this.system(`You switched the party to “${d.title}”.`);
        return;
      }
      if (OPU.videoKey(location.href) === OPU.videoKey(d.url)) return;
      const go = document.createElement("button");
      go.textContent = "Go now";
      go.addEventListener("click", () => location.assign(d.url));
      const line = this.system(`${this.nameOf(d.by)} switched to “${d.title}”.`, go);
      let sameOrigin = false;
      try {
        sameOrigin = new URL(d.url).origin === location.origin;
      } catch {
        // invalid URL; manual only
      }
      if (sameOrigin) {
        line.append(" Following in 3 s…");
        setTimeout(() => {
          if (this.room && OPU.videoKey(this.room.video.url) === OPU.videoKey(d.url)) location.assign(d.url);
        }, 3000);
      }
    }

    floatEmoji(emoji) {
      const el = document.createElement("div");
      el.className = "float";
      el.textContent = emoji;
      el.style.right = `${24 + Math.random() * 120}px`;
      this.root.append(el);
      setTimeout(() => el.remove(), 2700);
    }

    toast(text) {
      const t = this.$(".toast");
      t.textContent = text;
      t.hidden = false;
      if (this.$(".panel").hidden) this.open(true);
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => (t.hidden = true), 3500);
    }

    // ---- user actions ----

    async onAction(button) {
      if (!button) return;
      const act = button.dataset.act;
      if (act === "min") return this.open(false);
      if (act === "invite") return this.copyInvite();
      if (act === "lock") {
        if (!this.isHost) return;
        const res = await OP.send({ op: "lock", on: !this.room.controlLock });
        if (res && res.error) this.toast(res.error);
        return;
      }
      if (act === "leave") {
        if (this.leaveArmed) {
          clearTimeout(this.leaveArmed);
          OP.send({ op: "leave" });
          return;
        }
        button.classList.add("warn");
        button.textContent = "Leave?";
        this.leaveArmed = setTimeout(() => {
          this.leaveArmed = null;
          button.classList.remove("warn");
          button.textContent = "✕";
        }, 3000);
      }
    }

    insertText(text) {
      const input = this.$("textarea");
      if (input.value.length + text.length > Number(input.maxLength)) return;
      input.focus();
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
      this.onTyping();
    }

    async copyInvite() {
      const url = this.room.inviteUrl;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard API blocked by the page; fall back to a temporary textarea.
        const ta = document.createElement("textarea");
        ta.value = url;
        this.root.append(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      }
      this.toast(copied ? "Invite link copied. Send it to your friends!" : `Invite link: ${url}`);
    }

    submit() {
      const input = this.$("textarea");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.showPicker(false);
      this.setTyping(false);
      OP.send({ op: "chat", text }).then((res) => res && res.error && this.toast(res.error));
    }

    onTyping() {
      if (!this.$("textarea").value) return this.setTyping(false);
      this.setTyping(true);
      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => this.setTyping(false), 3000);
    }

    setTyping(on) {
      if (on === this.typingOn) return;
      this.typingOn = on;
      OP.send({ op: "typing", on });
    }
  }

  OP.ui = new Panel();
})();

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
    .toast { position: absolute; left: 12px; right: 12px; bottom: 60px; padding: 8px 10px; border-radius: 10px;
      background: #2b2b38; border: 1px solid #ffffff1f; font-size: 12px; text-align: center; }
    .float { position: fixed; bottom: 90px; font-size: 32px; pointer-events: none;
      animation: rise 2.6s ease-out forwards; }
    @keyframes rise { 0% { transform: translateY(0) scale(.6); opacity: 0; } 15% { opacity: 1; transform: translateY(-30px) scale(1.1); }
      100% { transform: translateY(-320px) scale(1); opacity: 0; } }
    .standalone { position: fixed; right: 16px; bottom: 16px; padding: 10px 14px; border-radius: 12px;
      background: #2b2b38; box-shadow: 0 6px 20px #0008; }
  `;

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
          "form",
          {},
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

      // Keep keystrokes in the chat box away from site shortcuts (space = pause etc.).
      for (const type of ["keydown", "keyup", "keypress"]) this.host.addEventListener(type, (e) => e.stopPropagation());

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
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.submit();
        }
      });
      input.addEventListener("input", () => this.onTyping());
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

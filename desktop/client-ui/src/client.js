window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-desktop-client-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    // ── styles ─────────────────────────────────────────────────────────────
    const css = [
      ".dab-section{padding:8px 0;display:flex;flex-direction:column;gap:8px}",
      ".dab-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}",
      ".dab-title{font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".dab-row{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
      ".dab-row span:last-child,.dab-row a{color:var(--dsw-alias-label-primary);text-align:right;word-break:break-all}",
      ".dab-row a{text-decoration:none}",
      ".dab-row a:hover{text-decoration:underline}",
      ".dab-check{display:flex;align-items:center;gap:10px;margin-top:4px}",
      ".dab-button{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}",
      ".dab-button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dab-buttonPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}",
      ".dab-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}",
      ".dab-statusWarn{color:var(--dsw-alias-state-warn-label)}",
      ".dab-badge{position:absolute;inset-inline-end:8px;top:50%;z-index:1;flex:none;height:24px;padding:0 8px;transform:translateY(-50%);border-radius:999px;border:none;background:var(--dsw-alias-brand-primary);color:#fff;font-size:12px;font-weight:600;line-height:16px;cursor:pointer}",
      ".dab-badgeRail{inset-inline-end:0;width:10px;height:10px;padding:0;border:2px solid var(--dsw-alias-bg-layer-1);border-radius:50%;font-size:0;line-height:0}",
      ".dab-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:flex;align-items:center;justify-content:center}",
      ".dab-dialog{width:min(400px,calc(100vw - 48px));border:1px solid var(--dsw-alias-border-inverted);border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-shadow-lv3);padding:20px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}",
      ".dab-dialogTitle{font-size:16px;font-weight:600;line-height:24px}",
      ".dab-dialogBody{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
      ".dab-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}",
    ].join("");

    const tagId = "@deepseek-ai/dsh-desktop-client-ui/about.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@deepseek-ai/dsh-desktop-client-ui";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── dictionaries ───────────────────────────────────────────────────────
    const NS = "desktopClientUi";
    const zh = {
      "about.nav": "关于桌面版",
      "about.title": "DeepSeek Harness Desktop",
      "about.desktopVersion": "桌面版版本",
      "about.kernelVersion": "Harness 内核版本",
      "about.repository": "项目地址",
      "about.author": "作者",
      "about.check": "检查更新",
      "about.checking": "正在检查更新…",
      "about.upToDate": "已是最新版本（{version}）",
      "about.checkFailed": "检查更新失败（网络不可用）",
      "about.updateFound": "发现新版本 {version}",
      "badge.update": "更新",
      "dialog.title": "发现新版本",
      "dialog.body": "当前版本 {current}，最新版本 {latest}。点击「去更新」前往发布页面。",
      "dialog.later": "稍后",
      "dialog.go": "去更新",
    };
    const en = {
      "about.nav": "About Desktop",
      "about.title": "DeepSeek Harness Desktop",
      "about.desktopVersion": "Desktop version",
      "about.kernelVersion": "Harness kernel version",
      "about.repository": "Repository",
      "about.author": "Author",
      "about.check": "Check for updates",
      "about.checking": "Checking for updates…",
      "about.upToDate": "Up to date ({version})",
      "about.checkFailed": "Update check failed (network unavailable)",
      "about.updateFound": "New version available: {version}",
      "badge.update": "Update",
      "dialog.title": "New version available",
      "dialog.body": "Current {current}, latest {latest}. Use “Go to update” to open the release page.",
      "dialog.later": "Later",
      "dialog.go": "Go to update",
    };

    // ── helpers ────────────────────────────────────────────────────────────
    function parseVersion(value) {
      return String(value).replace(/^v/i, "").split("-")[0].split(".").map((part) => parseInt(part, 10) || 0);
    }
    function isNewer(candidate, baseline) {
      const a = parseVersion(candidate);
      const b = parseVersion(baseline);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const da = a[i] ?? 0;
        const db = b[i] ?? 0;
        if (da !== db) return da > db;
      }
      return false;
    }
    function releasesUrl(repository) {
      const match = String(repository).match(/github\.com\/([^/]+)\/([^/\s#]+)/);
      if (match === null) return null;
      return `https://api.github.com/repos/${match[1]}/${match[2].replace(/\.git$/, "")}/releases/latest`;
    }
    async function fetchLatest(repository) {
      const url = releasesUrl(repository);
      if (url === null) return null;
      try {
        const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) return null;
        const data = await response.json();
        if (typeof data?.tag_name !== "string" || typeof data?.html_url !== "string") return null;
        return { version: data.tag_name, htmlUrl: data.html_url };
      } catch {
        return null;
      }
    }
    function useDesktopInfo() {
      const [info, setInfo] = React.useState(null);
      React.useEffect(() => {
        let live = true;
        fetch("/desktop-info.json")
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => { if (live) setInfo(data); })
          .catch(() => {});
        return () => { live = false; };
      }, []);
      return info;
    }

    // ── components ─────────────────────────────────────────────────────────
    function UpdateDialog({ latest, info, t, onClose }) {
      const go = () => {
        if (typeof latest?.htmlUrl === "string" && latest.htmlUrl !== "") window.location.href = latest.htmlUrl;
      };
      return React.createElement("div", { className: "dab-backdrop", onClick: onClose },
        React.createElement("div", {
          className: "dab-dialog",
          role: "dialog",
          "aria-modal": "true",
          onClick: (event) => { event.stopPropagation(); },
        },
          React.createElement("div", { className: "dab-dialogTitle" }, t("dialog.title")),
          React.createElement("div", { className: "dab-dialogBody" },
            t("dialog.body", { current: info?.desktopVersion ?? "?", latest: latest.version })),
          React.createElement("div", { className: "dab-actions" },
            React.createElement("button", { type: "button", className: "dab-button", onClick: onClose }, t("dialog.later")),
            React.createElement("button", { type: "button", className: "dab-button dab-buttonPrimary", onClick: go }, t("dialog.go")),
          ),
        ),
      );
    }

    function AboutSection({ close, t }) {
      const info = useDesktopInfo();
      const [checking, setChecking] = React.useState(false);
      const [status, setStatus] = React.useState(null);
      const [latest, setLatest] = React.useState(null);

      const check = async () => {
        if (checking || info === null) return;
        setChecking(true);
        setStatus("checking");
        const found = await fetchLatest(info.repository);
        setChecking(false);
        if (found === null) {
          setStatus("failed");
          return;
        }
        setLatest(found);
        if (isNewer(found.version, info.desktopVersion)) setStatus("update");
        else setStatus("uptodate");
      };

      return React.createElement("div", { className: "dab-section" },
        React.createElement("div", { className: "dab-card" },
          React.createElement("div", { className: "dab-title" }, t("about.title")),
          React.createElement("div", { className: "dab-row" },
            React.createElement("span", null, t("about.desktopVersion")),
            React.createElement("span", null, info?.desktopVersion ?? "—"),
          ),
          React.createElement("div", { className: "dab-row" },
            React.createElement("span", null, t("about.kernelVersion")),
            React.createElement("span", null, info?.kernelVersion ?? "—"),
          ),
          React.createElement("div", { className: "dab-row" },
            React.createElement("span", null, t("about.repository")),
            React.createElement("a", { href: info?.repository ?? "#", target: "_self" }, info?.repository ?? "—"),
          ),
          React.createElement("div", { className: "dab-row" },
            React.createElement("span", null, t("about.author")),
            React.createElement("span", null, info?.author ?? "—"),
          ),
          React.createElement("div", { className: "dab-check" },
            React.createElement("button", { type: "button", className: "dab-button", disabled: checking, onClick: () => { void check(); } }, t("about.check")),
            status === "checking" && React.createElement("span", { className: "dab-status" }, t("about.checking")),
            status === "uptodate" && React.createElement("span", { className: "dab-status" }, t("about.upToDate", { version: latest?.version ?? "" })),
            status === "failed" && React.createElement("span", { className: "dab-status dab-statusWarn" }, t("about.checkFailed")),
            status === "update" && React.createElement("span", { className: "dab-status dab-statusWarn" }, t("about.updateFound", { version: latest?.version ?? "" })),
          ),
        ),
        status === "update" && latest !== null && React.createElement(UpdateDialog, {
          latest, info, t, onClose: () => { setStatus("uptodate"); },
        }),
        close !== undefined && null,
      );
    }

    function UpdateBadge({ wide, t }) {
      const info = useDesktopInfo();
      const [latest, setLatest] = React.useState(null);
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => {
        if (info === null) return;
        let live = true;
        const poll = async () => {
          const found = await fetchLatest(info.repository);
          if (!live || found === null) return;
          setLatest((previous) => previous?.version === found.version ? previous : found);
        };
        void poll();
        const interval = setInterval(() => { void poll(); }, 30 * 60 * 1000);
        return () => { live = false; clearInterval(interval); };
      }, [info]);

      if (latest === null || !isNewer(latest.version, info?.desktopVersion)) return null;
      return React.createElement(React.Fragment, null,
        React.createElement("button", {
          type: "button",
          className: wide ? "dab-badge" : "dab-badge dab-badgeRail",
          title: t("about.updateFound", { version: latest.version }),
          "aria-label": t("badge.update"),
          onClick: () => { setOpen(true); },
        }, wide ? t("badge.update") : "·"),
        open && React.createElement(UpdateDialog, {
          latest, info, t, onClose: () => { setOpen(false); },
        }),
      );
    }

    // ── plugin body ────────────────────────────────────────────────────────
    const inject = [];

    function apply(ctx) {
      const locale = ctx.get("locale");
      const slots = ctx.get("slots");
      if (locale === undefined || slots === undefined) return;
      ctx.effect(() => locale.register(NS, { zh, en }), "desktop-client-ui: dictionaries");
      ctx.effect(() => {
        const root = document.documentElement;
        const previous = root.dataset.dshDesktopLocale;
        const sync = () => { root.dataset.dshDesktopLocale = locale.getSnapshot().active; };
        sync();
        const unsubscribe = locale.subscribe(sync);
        return () => {
          unsubscribe();
          if (previous === undefined) delete root.dataset.dshDesktopLocale;
          else root.dataset.dshDesktopLocale = previous;
        };
      }, "desktop-client-ui: bridge locale");
      slots.inject("settings.section", () => slots.register({
        name: "settings.section",
        id: "desktop-about",
        order: 99,
        label: () => locale.bind(NS)("about.nav"),
        locale: NS,
      }, AboutSection));
      slots.inject("settings.update", () => slots.register({
        name: "settings.update",
        locale: NS,
      }, UpdateBadge));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

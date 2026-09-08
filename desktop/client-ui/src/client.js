window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-desktop-client-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      Button,
      IconChevronRightOutline14,
      IconDownloadOutline16,
      MarkdownText,
      Modal,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

    // ── styles ─────────────────────────────────────────────────────────────
    const css = [
      ".dab-section{padding:8px 0;display:flex;flex-direction:column;gap:8px}",
      ".dab-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}",
      ".dab-title{font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".dab-row{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
      ".dab-row span:last-child,.dab-row a{color:var(--dsw-alias-label-primary);text-align:right;word-break:break-all}",
      ".dab-row a{text-decoration:none}",
      ".dab-row a:hover{text-decoration:underline}",
      ".dab-check{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}",
      ".dab-button{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}",
      ".dab-button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dab-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}",
      ".dab-statusWarn{color:var(--dsw-alias-state-warn-label)}",
      ".dab-badge{position:static;align-self:stretch;z-index:1;flex:none;height:30px;margin:0 0 4px;padding:0 10px;border-radius:10px;border:none;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;font-weight:600;line-height:16px;cursor:pointer}",
      ".dab-badgeRail{align-self:center;width:10px;height:10px;margin:0 0 4px;padding:0;border:2px solid var(--dsw-alias-bg-layer-1);border-radius:50%;font-size:0;line-height:0}",
      ".dab-brandLabel{font-size:17px;font-weight:600;letter-spacing:0;white-space:nowrap}",
      ".dab-brandVersion{display:inline-flex;align-items:center;height:16px;padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:8px;font-weight:500;line-height:16px}",
      ".dab-updateDialog{width:min(560px,100%);max-height:calc(100vh - 48px);min-height:0}",
      ".dab-updateDialogContent{display:flex;min-height:0;flex:1 1 auto;overflow:hidden}",
      ".dab-updateDialogContent>div:last-child{min-height:0;flex:1 1 auto;overflow:hidden}",
      ".dab-versionSummary{display:grid;grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr);align-items:center;gap:12px;padding:0 0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".dab-versionCell{display:flex;min-width:0;flex-direction:column;gap:3px}",
      ".dab-versionLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}",
      ".dab-versionValue{overflow:hidden;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:15px;font-weight:600;line-height:22px;text-overflow:ellipsis;white-space:nowrap}",
      ".dab-versionLatest .dab-versionValue{color:var(--dsw-alias-brand-primary)}",
      ".dab-versionArrow{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}",
      ".dab-releaseSection{display:flex;min-height:0;flex:1 1 auto;flex-direction:column;gap:10px;padding-top:18px}",
      ".dab-releaseHeading{margin:0;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}",
      ".dab-releaseNotes{min-height:0;max-height:min(48vh,420px);flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 10px 0 0;color:var(--dsw-alias-label-secondary)}",
      ".dab-releaseNotes :is(h1,h2,h3,h4,h5,h6){margin:14px 0 8px;font-size:14px;font-weight:600;line-height:22px;letter-spacing:0;color:var(--dsw-alias-label-primary)}",
      ".dab-releaseNotes :is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0}",
      ".dab-releaseNotes :is(p,ul,ol){font-size:13px;line-height:21px}",
      ".dab-releaseNotes :is(ul,ol){padding-left:20px}",
      ".dab-releaseNotesEmpty{margin:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-caption)}",
      ".dab-startLink{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border-radius:18px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:14px;line-height:22px;text-decoration:none}",
      ".dab-startLink:hover{background:var(--dsw-alias-button-primary-hover);text-decoration:none}",
      ".dab-startLinkIcon{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center}",
      "html.ddu-file-drag-active body>[role=status]{inset:var(--ddu-drop-top) var(--ddu-drop-right) var(--ddu-drop-bottom) var(--ddu-drop-left);background-color:var(--dsw-alias-bg-mask-drop);backdrop-filter:blur(18px) saturate(1.06);-webkit-backdrop-filter:blur(18px) saturate(1.06)}",
      "html.ddu-file-drag-active body>[role=status]>div{padding:28px 52px;border:1px solid var(--dsw-alias-border-l2);border-radius:24px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv3);animation:ddu-drop-focus-in 180ms cubic-bezier(.2,.8,.2,1)}",
      "html.ddu-file-drag-active body>[role=status] svg{transform:translateY(-2px) scale(1.04)}",
      "html.ddu-file-drag-active body>[role=status]>div>div:nth-child(3){display:none}",
      "html.ddu-file-drag-active body>[role=status]>div>div:nth-child(2){font-size:0}",
      "html.ddu-file-drag-active body>[role=status][data-dsh-drop-accepting=\"true\"]>div>div:nth-child(2)::after{content:var(--ddu-drop-enabled-copy);display:block;font:var(--dsw-font-l-20);color:var(--dsw-alias-label-primary)}",
      "html.ddu-file-drag-active body>[role=status][data-dsh-drop-accepting=\"false\"]>div>div:nth-child(2)::after{content:var(--ddu-drop-blocked-copy);display:block;font:var(--dsw-font-l-20);color:var(--dsw-alias-label-primary)}",
      "@keyframes ddu-drop-focus-in{from{opacity:.72;transform:translateY(8px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}",
      "@media (prefers-reduced-motion:reduce){html.ddu-file-drag-active body>[role=status]>div{animation:none}}",
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
      "about.nav": "关于DeepDive",
      "about.title": "DeepDive",
      "about.desktopVersion": "DeepDive版本",
      "about.kernelVersion": "Harness 内核版本",
      "about.repository": "项目地址",
      "about.author": "作者",
      "about.check": "检查更新",
      "about.checking": "正在检查更新…",
      "about.upToDate": "已是最新版本（{version}）",
      "about.checkFailed": "检查更新失败（网络不可用）",
      "about.updateFound": "发现新版本 {version}",
      "about.view": "查看更新",
      "drop.release": "松开即可添加",
      "drop.blocked": "当前无法添加",
      "badge.update": "更新",
      "dialog.title": "DeepDive 更新",
      "dialog.close": "关闭更新窗口",
      "dialog.current": "当前版本",
      "dialog.latest": "新版本",
      "dialog.notes": "更新内容",
      "dialog.emptyNotes": "此版本未提供更新说明。",
      "dialog.later": "稍后",
      "dialog.start": "开始更新",
    };
    const en = {
      "about.nav": "About DeepDive",
      "about.title": "DeepDive",
      "about.desktopVersion": "DeepDive version",
      "about.kernelVersion": "Harness kernel version",
      "about.repository": "Repository",
      "about.author": "Author",
      "about.check": "Check for updates",
      "about.checking": "Checking for updates…",
      "about.upToDate": "Up to date ({version})",
      "about.checkFailed": "Update check failed (network unavailable)",
      "about.updateFound": "New version available: {version}",
      "about.view": "View update",
      "drop.release": "Release to add",
      "drop.blocked": "Cannot add now",
      "badge.update": "Update",
      "dialog.title": "DeepDive update",
      "dialog.close": "Close update dialog",
      "dialog.current": "Current version",
      "dialog.latest": "New version",
      "dialog.notes": "What's new",
      "dialog.emptyNotes": "No release notes were provided for this version.",
      "dialog.later": "Later",
      "dialog.start": "Start update",
    };

    // ── helpers ────────────────────────────────────────────────────────────
    function compareNumericIdentifier(a, b) {
      if (a.length !== b.length) return a.length > b.length ? 1 : -1;
      if (a === b) return 0;
      return a > b ? 1 : -1;
    }
    function parseVersion(value) {
      const match = String(value).trim().match(
        /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
      );
      if (match === null) return null;
      const prerelease = match[4] === undefined ? [] : match[4].split(".");
      if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
      return {
        core: [match[1], match[2], match[3]],
        prerelease,
      };
    }
    function isNewer(candidate, baseline) {
      const a = parseVersion(candidate);
      const b = parseVersion(baseline);
      if (a === null || b === null) return false;
      for (let i = 0; i < a.core.length; i++) {
        const comparison = compareNumericIdentifier(a.core[i], b.core[i]);
        if (comparison !== 0) return comparison > 0;
      }
      if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        return a.prerelease.length === 0 && b.prerelease.length > 0;
      }
      for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        const da = a.prerelease[i];
        const db = b.prerelease[i];
        if (da === undefined || db === undefined) return da !== undefined;
        if (da === db) continue;
        const aNumeric = /^\d+$/.test(da);
        const bNumeric = /^\d+$/.test(db);
        if (aNumeric && bNumeric) return compareNumericIdentifier(da, db) > 0;
        if (aNumeric !== bNumeric) return !aNumeric;
        return da > db;
      }
      return false;
    }
    function releasesUrl(repository) {
      const match = String(repository).match(/github\.com\/([^/]+)\/([^/\s#]+)/);
      if (match === null) return null;
      return `https://api.github.com/repos/${match[1]}/${match[2].replace(/\.git$/, "")}/releases/latest`;
    }
    function releaseAssetName(version) {
      const normalized = String(version).replace(/^v/i, "");
      if (navigator.userAgent.includes("Windows")) return `deepdive-windows-x64-${normalized}.exe`;
      if (navigator.userAgent.includes("Macintosh")) return `deepdive-macos-arm64-${normalized}.dmg`;
      return null;
    }
    function fileTransfer(event) {
      const dataTransfer = event.dataTransfer;
      if (dataTransfer === null || dataTransfer === undefined) return null;
      return Array.from(dataTransfer.types).includes("Files") ? dataTransfer : null;
    }
    function desktopDropRegion() {
      const overlayLayer = document.querySelector("[data-shell-overlay]");
      const frame = overlayLayer?.parentElement;
      const sidebar = frame?.firstElementChild;
      if (!(frame instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return null;
      const frameBox = frame.getBoundingClientRect();
      const sidebarBox = sidebar.getBoundingClientRect();
      const left = Math.max(frameBox.left, Math.min(frameBox.right, sidebarBox.right));
      if (frameBox.width <= 0 || frameBox.height <= 0 || left >= frameBox.right) return null;
      return {
        top: Math.max(0, frameBox.top),
        right: Math.max(0, window.innerWidth - frameBox.right),
        bottom: Math.max(0, window.innerHeight - frameBox.bottom),
        left,
      };
    }
    function installDesktopDropFeedback(dropCopy, blockedCopy) {
      const root = document.documentElement;
      let dragDepth = 0;
      const reset = () => {
        dragDepth = 0;
        root.classList.remove("ddu-file-drag-active");
        for (const name of ["--ddu-drop-top", "--ddu-drop-right", "--ddu-drop-bottom", "--ddu-drop-left", "--ddu-drop-enabled-copy", "--ddu-drop-blocked-copy"]) {
          root.style.removeProperty(name);
        }
      };
      const applyDropRegion = () => {
        const region = desktopDropRegion();
        if (region === null) return;
        root.style.setProperty("--ddu-drop-top", `${region.top}px`);
        root.style.setProperty("--ddu-drop-right", `${region.right}px`);
        root.style.setProperty("--ddu-drop-bottom", `${region.bottom}px`);
        root.style.setProperty("--ddu-drop-left", `${region.left}px`);
        root.style.setProperty("--ddu-drop-enabled-copy", JSON.stringify(dropCopy()));
        root.style.setProperty("--ddu-drop-blocked-copy", JSON.stringify(blockedCopy()));
        root.classList.add("ddu-file-drag-active");
      };
      const onDragEnter = (event) => {
        const dataTransfer = fileTransfer(event);
        if (dataTransfer === null) return;
        dragDepth += 1;
        applyDropRegion();
      };
      const onDragOver = (event) => {
        const dataTransfer = fileTransfer(event);
        if (dataTransfer === null) return;
        applyDropRegion();
      };
      const onDragLeave = (event) => {
        if (fileTransfer(event) === null) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
          reset();
          return;
        }
        const leftViewport = event.clientX <= 0 || event.clientY <= 0
          || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
        if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset();
      };
      const onDrop = (event) => {
        if (fileTransfer(event) !== null) reset();
      };
      document.addEventListener("dragenter", onDragEnter);
      document.addEventListener("dragover", onDragOver);
      document.addEventListener("dragleave", onDragLeave);
      document.addEventListener("drop", onDrop);
      window.addEventListener("dragend", reset);
      return () => {
        reset();
        document.removeEventListener("dragenter", onDragEnter);
        document.removeEventListener("dragover", onDragOver);
        document.removeEventListener("dragleave", onDragLeave);
        document.removeEventListener("drop", onDrop);
        window.removeEventListener("dragend", reset);
      };
    }
    async function fetchLatest(repository) {
      const url = releasesUrl(repository);
      if (url === null) return null;
      try {
        const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) return null;
        const data = await response.json();
        if (typeof data?.tag_name !== "string" || typeof data?.html_url !== "string") return null;
        const expectedAsset = releaseAssetName(data.tag_name);
        const asset = expectedAsset === null || !Array.isArray(data.assets)
          ? null
          : data.assets.find((candidate) => candidate?.name === expectedAsset
            && typeof candidate?.browser_download_url === "string");
        return {
          version: data.tag_name,
          htmlUrl: data.html_url,
          downloadUrl: asset?.browser_download_url ?? data.html_url,
          notes: typeof data.body === "string" ? data.body.trim() : "",
        };
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
      const footer = React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: "outline", onClick: onClose }, t("dialog.later")),
        React.createElement("a", {
          className: "dab-startLink",
          href: latest.downloadUrl,
          target: "_self",
        },
          React.createElement("span", { className: "dab-startLinkIcon" },
            React.createElement(IconDownloadOutline16, { size: 16 })),
          t("dialog.start"),
        ),
      );
      return React.createElement(Modal, {
        open: true,
        onClose,
        title: t("dialog.title"),
        closeLabel: t("dialog.close"),
        className: "dab-updateDialog",
        contentClassName: "dab-updateDialogContent",
        footer,
      },
        React.createElement("div", { className: "dab-versionSummary" },
          React.createElement("div", { className: "dab-versionCell" },
            React.createElement("span", { className: "dab-versionLabel" }, t("dialog.current")),
            React.createElement("span", { className: "dab-versionValue" }, `v${String(info?.desktopVersion ?? "?").replace(/^v/i, "")}`),
          ),
          React.createElement("span", { className: "dab-versionArrow", "aria-hidden": "true" },
            React.createElement(IconChevronRightOutline14, { size: 14 })),
          React.createElement("div", { className: "dab-versionCell dab-versionLatest" },
            React.createElement("span", { className: "dab-versionLabel" }, t("dialog.latest")),
            React.createElement("span", { className: "dab-versionValue" }, latest.version),
          ),
        ),
        React.createElement("section", { className: "dab-releaseSection" },
          React.createElement("h3", { className: "dab-releaseHeading" }, t("dialog.notes")),
          React.createElement("div", { className: "dab-releaseNotes" },
            latest.notes === ""
              ? React.createElement("p", { className: "dab-releaseNotesEmpty" }, t("dialog.emptyNotes"))
              : React.createElement(MarkdownText, { text: latest.notes }),
          ),
        ),
      );
    }

    function AboutSection({ close, t }) {
      const info = useDesktopInfo();
      const [checking, setChecking] = React.useState(false);
      const [status, setStatus] = React.useState(null);
      const [latest, setLatest] = React.useState(null);
      const [dialogOpen, setDialogOpen] = React.useState(false);

      const check = async () => {
        if (checking || info === null) return;
        setDialogOpen(false);
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
            status === "update" && React.createElement("button", {
              type: "button",
              className: "dab-button",
              onClick: () => { setDialogOpen(true); },
            }, t("about.view")),
          ),
        ),
        dialogOpen && status === "update" && latest !== null && React.createElement(UpdateDialog, {
          latest, info, t, onClose: () => { setDialogOpen(false); },
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
          setLatest((previous) => previous?.version === found.version
            && previous?.notes === found.notes
            && previous?.downloadUrl === found.downloadUrl
            ? previous
            : found);
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

    function DesktopBrandName() {
      const info = useDesktopInfo();
      return React.createElement(React.Fragment, null,
        React.createElement("span", { className: "dab-brandLabel" }, "DeepDive"),
        info?.desktopVersion !== undefined && React.createElement(
          "span", { className: "dab-brandVersion" }, info.desktopVersion),
      );
    }

    // ── plugin body ────────────────────────────────────────────────────────
    // Cordis must wait for both services before running this plugin.
    const inject = ["locale", "slots"];

    function apply(ctx) {
      const locale = ctx.locale;
      const slots = ctx.slots;
      ctx.effect(() => locale.register(NS, { zh, en }), "desktop-client-ui: dictionaries");
      ctx.effect(
        () => installDesktopDropFeedback(
          () => locale.bind(NS)("drop.release"),
          () => locale.bind(NS)("drop.blocked"),
        ),
        "desktop-client-ui: image-drop feedback",
      );
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
      slots.inject("sidebar.brand.name", () => slots.register({
        name: "sidebar.brand.name",
      }, DesktopBrandName));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

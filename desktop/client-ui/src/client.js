window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-desktop-client-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      Button,
      IconChevronRightOutlineRegular,
      IconDownloadOutlineRegular,
      MarkdownText,
      Modal,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

    // The macOS overlay leaves the custom brand group a little high. Relative
    // positioning moves both slot occupants' paint, so the logo row keeps its
    // 60px layout and Windows keeps the upstream position.
    const macOSBrandTitleAdjustment = navigator.userAgent.includes("Macintosh")
      ? "[data-slot=\"sidebar.brand.mark\"]>*,[data-slot=\"sidebar.brand.name\"]>*{position:relative;top:4px}"
      : "";

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
      ".dab-ignoreGroup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-right:auto;text-align:left}",
      ".dab-badge{position:static;align-self:stretch;z-index:1;flex:none;height:30px;margin:0 0 4px;padding:0 10px;border-radius:10px;border:none;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;font-weight:600;line-height:16px;cursor:pointer}",
      ".dab-badgeRail{align-self:center;width:10px;height:10px;margin:0 0 4px;padding:0;border:2px solid var(--dsw-alias-bg-layer-1);border-radius:50%;font-size:0;line-height:0}",
      ".dab-brandLabel{font-size:17px;font-weight:600;letter-spacing:0;white-space:nowrap}",
      ".dab-brandVersion{display:inline-flex;align-items:center;height:16px;padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:8px;font-weight:500;line-height:16px}",
      macOSBrandTitleAdjustment,
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
      "about.cli": "命令行工具 dsh",
      "about.cliInstalled": "已安装",
      "about.cliMissing": "未安装",
      "about.cliInstall": "安装",
      "about.cliRemove": "移除",
      "about.cliInstalledHint": "已写入 {path}",
      "about.cliOnPathHint": "{path}（所在目录不在 PATH 中）",
      "about.cliFailed": "操作失败",
      "drop.release": "松开即可添加",
      "drop.blocked": "当前无法添加",
      "badge.update": "更新",
      "dialog.title": "DeepDive 更新",
      "dialog.close": "关闭更新窗口",
      "dialog.current": "当前版本",
      "dialog.latest": "新版本",
      "dialog.notes": "更新内容",
      "dialog.emptyNotes": "此版本未提供更新说明。",
      "dialog.start": "开始更新",
      "dialog.ignore": "忽略本次版本",
      "dialog.ignoreHint": "忽略后可在「设置 → 关于 DeepDive」继续更新",
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
      "about.cli": "Command-line tool dsh",
      "about.cliInstalled": "Installed",
      "about.cliMissing": "Not installed",
      "about.cliInstall": "Install",
      "about.cliRemove": "Remove",
      "about.cliInstalledHint": "Written to {path}",
      "about.cliOnPathHint": "{path} (its directory is not on PATH)",
      "about.cliFailed": "The operation failed",
      "drop.release": "Release to add",
      "drop.blocked": "Cannot add now",
      "badge.update": "Update",
      "dialog.title": "DeepDive update",
      "dialog.close": "Close update dialog",
      "dialog.current": "Current version",
      "dialog.latest": "New version",
      "dialog.notes": "What's new",
      "dialog.emptyNotes": "No release notes were provided for this version.",
      "dialog.start": "Start update",
      "dialog.ignore": "Skip this version",
      "dialog.ignoreHint": "You can update later in Settings → About DeepDive",
    };

    // ── helpers ────────────────────────────────────────────────────────────
    /**
     * Render one version with the tag spelling every surface uses.
     * @param value - version text with or without the tag prefix.
     * @returns the `v`-prefixed form, or an em dash when nothing is known.
     */
    function displayVersion(value) {
      const bare = stripVersion(value);
      return bare === "" ? "—" : `v${bare}`;
    }
    /**
     * The release the shell reported, or `undefined` when this build is current.
     *
     * The shell serialises an absent release as `null`, and an update surface
     * that treated that as a release would offer an empty version.
     * @param report - release report from the shell.
     * @returns the bare version of the release to offer.
     */
    function reportedLatest(report) {
      const latest = report === undefined || report === null ? undefined : report.latest;
      if (typeof latest !== "string") return undefined;
      return stripVersion(latest) === "" ? undefined : latest;
    }
    /**
     * Drop the tag prefix one version text may or may not carry.
     * @param value - version text from the shell or from the stored preference.
     * @returns the bare version, or an empty string when nothing is known.
     */
    function stripVersion(value) {
      if (value === undefined || value === null) return "";
      return String(value).replace(/^v/i, "");
    }
    /**
     * Installer link for this platform from the release's asset map.
     *
     * The shell reads the release feed, so the page never compares versions or
     * picks an asset out of a second document: it renders what the shell found.
     * @param release - release facts reported by the shell.
     * @returns the installer link, or the release page when this platform has none.
     */
    function downloadUrlFor(release) {
      const assets = release.assets ?? {};
      const agent = navigator.userAgent;
      const asset = agent.includes("Windows")
        ? assets.windows
        : agent.includes("Macintosh")
          ? assets.macos
          : /Linux (?:x86_64|x64)/.test(agent) ? assets.linuxAppImage : undefined;
      return asset ?? release.page ?? "#";
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

    // ── ignored release ────────────────────────────────────────────────────
    // One preference read by the badge: the release whose reminder the user
    // skipped. It lives in the `desktop-client-ui` entry form this package's
    // Host half declares, so it survives a restart.
    const DESKTOP_UI_ENTRY = "desktop-client-ui";
    const ignoredListeners = new Set();
    let ignoredVersion;
    // Published by `apply`; inert until the plugin body runs.
    let ignoreRelease = () => {};
    function publishIgnoredVersion(next) {
      if (ignoredVersion === next) return;
      ignoredVersion = next;
      for (const listener of ignoredListeners) listener();
    }
    function subscribeIgnoredVersion(listener) {
      ignoredListeners.add(listener);
      return () => { ignoredListeners.delete(listener); };
    }
    function useIgnoredVersion() {
      const [version, setVersion] = React.useState(ignoredVersion);
      React.useEffect(() => {
        setVersion(ignoredVersion);
        return subscribeIgnoredVersion(() => { setVersion(ignoredVersion); });
      }, []);
      return version;
    }

    // ── components ─────────────────────────────────────────────────────────
    function UpdateDialog({ latest, info, t, onClose, onIgnore }) {
      const footer = React.createElement(React.Fragment, null,
        React.createElement("div", { className: "dab-ignoreGroup" },
          React.createElement(Button, { variant: "outline", onClick: onIgnore }, t("dialog.ignore")),
          React.createElement("span", { className: "dab-status" }, t("dialog.ignoreHint")),
        ),
        React.createElement("a", {
          className: "dab-startLink",
          href: latest.downloadUrl,
          target: "_self",
        },
          React.createElement("span", { className: "dab-startLinkIcon" },
            React.createElement(IconDownloadOutlineRegular, { size: 16 })),
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
            React.createElement(IconChevronRightOutlineRegular, { size: 14 })),
          React.createElement("div", { className: "dab-versionCell dab-versionLatest" },
            React.createElement("span", { className: "dab-versionLabel" }, t("dialog.latest")),
            React.createElement("span", { className: "dab-versionValue" }, displayVersion(latest.version)),
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

    // ── dsh command installation ───────────────────────────────────────────
    /**
     * The shell owns the launcher: it decides where the file belongs, writes it
     * from the packaged Node and CLI paths, and removes only a file it still
     * recognises. This hook only asks and reports.
     * @returns the launcher state and the two operations over it.
     */
    function useCliCommand() {
      const bridge = globalThis.dshDesktop?.cli;
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const refresh = React.useCallback(() => {
        if (bridge === undefined) return;
        void bridge.status().then(setStatus, () => { setFailed(true); });
      }, [bridge]);
      React.useEffect(refresh, [refresh]);
      const run = React.useCallback((operation) => {
        if (bridge === undefined || busy) return;
        setBusy(true);
        setFailed(false);
        void (operation === "install" ? bridge.install() : bridge.remove())
          .then(setStatus, () => { setFailed(true); })
          .finally(() => { setBusy(false); });
      }, [bridge, busy]);
      return { available: bridge !== undefined, status, busy, failed, run };
    }

    function CliCommandRow({ cli, t }) {
      if (!cli.available) return null;
      const installed = cli.status?.installed === true;
      const hint = cli.failed
        ? t("about.cliFailed")
        : installed
          ? t(cli.status.onPath ? "about.cliInstalledHint" : "about.cliOnPathHint", { path: cli.status.path })
          : "";
      return React.createElement(React.Fragment, null,
        React.createElement("div", { className: "dab-row" },
          React.createElement("span", null, t("about.cli")),
          React.createElement("span", null, installed ? t("about.cliInstalled") : t("about.cliMissing")),
        ),
        React.createElement("div", { className: "dab-check" },
          React.createElement("button", {
            type: "button",
            className: "dab-button",
            disabled: cli.busy || cli.status === null,
            onClick: () => { cli.run(installed ? "remove" : "install"); },
          }, installed ? t("about.cliRemove") : t("about.cliInstall")),
          hint !== "" && React.createElement("span", {
            className: cli.failed ? "dab-status dab-statusWarn" : "dab-status",
          }, hint),
        ),
      );
    }

    function AboutSection({ close, t }) {
      const info = useDesktopInfo();
      const cli = useCliCommand();
      const [checking, setChecking] = React.useState(false);
      const [status, setStatus] = React.useState(null);
      const [latest, setLatest] = React.useState(null);
      const [dialogOpen, setDialogOpen] = React.useState(false);

      const check = async () => {
        if (checking || info === null) return;
        setDialogOpen(false);
        setChecking(true);
        setStatus("checking");
        let found;
        try {
          found = await globalThis.dshDesktop.release.check();
        } catch (error) {
          // The shell reports a feed it could not read; the button says so
          // instead of pretending the installation is current.
          void error;
          setChecking(false);
          setStatus("failed");
          return;
        }
        setChecking(false);
        const version = reportedLatest(found);
        if (version === undefined) {
          setLatest(null);
          setStatus("uptodate");
          return;
        }
        setLatest({ ...found, version, downloadUrl: downloadUrlFor(found) });
        setStatus("update");
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
          React.createElement(CliCommandRow, { cli, t }),
          React.createElement("div", { className: "dab-check" },
            React.createElement("button", { type: "button", className: "dab-button", disabled: checking, onClick: () => { void check(); } }, t("about.check")),
            status === "checking" && React.createElement("span", { className: "dab-status" }, t("about.checking")),
            status === "uptodate" && React.createElement("span", { className: "dab-status" }, t("about.upToDate", { version: displayVersion(info?.desktopVersion) })),
            status === "failed" && React.createElement("span", { className: "dab-status dab-statusWarn" }, t("about.checkFailed")),
            status === "update" && React.createElement("span", { className: "dab-status dab-statusWarn" }, t("about.updateFound", { version: displayVersion(latest?.version) })),
            status === "update" && React.createElement("button", {
              type: "button",
              className: "dab-button",
              onClick: () => { setDialogOpen(true); },
            }, t("about.view")),
          ),
        ),
        dialogOpen && status === "update" && latest !== null && React.createElement(UpdateDialog, {
          latest, info, t,
          onClose: () => { setDialogOpen(false); },
          onIgnore: () => { setDialogOpen(false); ignoreRelease(latest.version); },
        }),
        close !== undefined && null,
      );
    }

    function UpdateBadge({ wide, t }) {
      const info = useDesktopInfo();
      const [latest, setLatest] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const ignored = useIgnoredVersion();

      React.useEffect(() => {
        if (info === null) return;
        let live = true;
        // The shell owns the schedule; the badge only re-reads its answer, so a
        // badge and a native reminder can never name different releases.
        const poll = async () => {
          let found;
          try {
            found = await globalThis.dshDesktop.release.state();
          } catch (error) {
            void error;
            return;
          }
          const version = reportedLatest(found);
          if (!live || version === undefined) return;
          const next = { ...found, version, downloadUrl: downloadUrlFor(found) };
          setLatest((previous) => previous?.version === next.version
            && previous?.notes === next.notes
            && previous?.downloadUrl === next.downloadUrl
            ? previous
            : next);
        };
        void poll();
        const interval = setInterval(() => { void poll(); }, 5 * 60 * 1000);
        return () => { live = false; clearInterval(interval); };
      }, [info]);

      if (latest === null) return null;
      // The ignored release stays quiet; a newer release replaces it. The stored
      // preference predates the shell's unprefixed version, so both spellings
      // name the same release.
      if (ignored !== undefined && stripVersion(ignored) === stripVersion(latest.version)) return null;
      return React.createElement(React.Fragment, null,
        React.createElement("button", {
          type: "button",
          className: wide ? "dab-badge" : "dab-badge dab-badgeRail",
          title: t("about.updateFound", { version: displayVersion(latest.version) }),
          "aria-label": t("badge.update"),
          onClick: () => { setOpen(true); },
        }, wide ? t("badge.update") : "·"),
        open && React.createElement(UpdateDialog, {
          latest, info, t,
          onClose: () => { setOpen(false); },
          onIgnore: () => { setOpen(false); ignoreRelease(latest.version); },
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
    // Cordis must wait for these services before running this plugin.
    const inject = ["locale", "slots", "configForms"];

    function apply(ctx) {
      const locale = ctx.locale;
      const slots = ctx.slots;
      ctx.effect(() => locale.register(NS, { zh, en }), "desktop-client-ui: dictionaries");
      const ignoredScope = ctx.configForms.get(DESKTOP_UI_ENTRY);
      ctx.effect(() => {
        const sync = () => { publishIgnoredVersion(ignoredScope.getSnapshot().value?.ignoredUpdateVersion); };
        sync();
        return ignoredScope.subscribe(sync);
      }, "desktop-client-ui: ignored release");
      ignoreRelease = (version) => {
        publishIgnoredVersion(version);
        void ignoredScope.set("ignoredUpdateVersion", version);
      };
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

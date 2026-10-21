# DeepDive 桌面能力补齐计划

Status: proposed

## A. 侧边栏浏览器（悬浮窗口承载）

### A1. 目标与验收

目标：侧边栏 Browser 标签能浏览任意 http/https 站点（含 `X-Frame-Options: DENY` 的 GitHub 等），视觉上是贴着侧边栏区域的悬浮面板，行为尽量接近 Electron 版。

已核实的关键前提（决定这条路可行）：

- [tauri#8705](https://github.com/tauri-apps/tauri/issues/8705)（macOS 双字符输入）issue 原文：「It doesn't happen in normal webview where it doesn't added as_child」→ 只在 `add_child` 下出现
- [tauri#10194](https://github.com/tauri-apps/tauri/issues/10194)（方向键打无效字符）复现步骤：「Enable unstable feature-flag」→ 只在 `unstable` 下出现

因此独立 `WebviewWindow`（正常 webview、不开 `unstable`）不受这两个 bug 影响；反向也说明放弃 `add_child` 是对的。

验收：

- 打开 Browser 标签 → 输入任意网址 → 页面正常显示、可点击/滚动/输入
- 前进/后退/刷新状态与操作正确；标题跟随页面标题
- 主窗口移动、缩放、最大化时悬浮窗逐帧跟随，无偏移、无明显甩尾
- 折叠侧栏 / 切到别的 tab / 主界面弹菜单 → 悬浮窗隐藏；恢复后位置正确
- 主窗口最小化 → 悬浮窗自动隐藏（`parent()` 语义）；恢复后位置正确
- `pnpm run test` 全绿 + 新增断言

### A2. 架构

```
主窗口 (label "main")
 ├─ 客户端：Browser 标签内一个锚点元素（适配层创建，只负责布局与测量）
 │    └─ ResizeObserver + rAF + window resize/scroll + 侧栏过渡 → 锚点 rect
 ├─ bridge：globalThis.dshDesktop.browser → invoke → Rust 命令
 └─ 原生：独立无边框 WebviewWindow（label "browser-guest-<n>"）
      ├─ parent(main)：Windows owned / Linux transient_for / macOS addChildWindow
      ├─ decorations(false) / skip_taskbar(true) / shadow(false) / resizable(false)
      └─ 位置尺寸 = 主窗口客户区原点 + 锚点 rect × scaleFactor
```

### A3. 实施

#### A3.1 Rust：`desktop/src-tauri/src/browser_window.rs`（新模块）

| 命令 | 行为 |
|---|---|
| `desktop_browser_acquire(workspace)` | 建承载窗口（`visible(false)` 起步、`parent(main)`、`data_directory(<appdata>/browser/<workspace hash>)`、`WebviewUrl::External("about:blank")`），注册 `on_page_load` / `on_document_title_changed` / `on_navigation` 写状态缓存并 emit；返回 `{lease, partition}` |
| `desktop_browser_bounds(lease, x, y, w, h)` | 见 A4 公式；首次有效调用后 `show()` |
| `desktop_browser_visible(lease, visible)` | `show()` / `hide()` |
| `desktop_browser_navigate(lease, url)` | 仅放行 http/https；拒绝其它 scheme |
| `desktop_browser_reload` / `back` / `forward` | 注入脚本提供的 `__dshBrowserNav.*`（见 A3.3） |
| `desktop_browser_state(lease)` | 返回缓存 `{url, title, loading, canGoBack, canGoForward}` |
| `desktop_browser_release(lease)` | `close()` 并清理缓存 |

窗口事件：主窗口 `WindowEvent::Moved`/`Resized` → 用最近一次锚点 rect 重算，保证拖拽/缩放时跟随。

#### A3.2 bridge：`desktop/bridge/src/index.ts`

```ts
globalThis.dshDesktop = {
  protocolVersion: 1,
  browser: {
    acquire, release, onOpenRequested,                       // 上游已有契约
    navigate, reload, goBack, goForward, clearHistory,
    state, onEvent, setBounds, setVisible,                   // 新增
  },
}
```

- `onEvent`：Tauri `listen` 订阅承载窗口事件
- `setBounds`：rAF 节流
- `clearHistory`：no-op（承载窗口不加载引导文档，`about:blank` 那条历史不存在；写注释说明）

#### A3.3 上游桌面适配层（用户已确认可改的范围）

| 文件 | 改动 |
|---|---|
| `packages/client/ui-sidebar-browser/src/types.ts` | 扩展 `DesktopBrowserBridge`（新增 A3.2 的方法 + `DesktopBrowserGuestState` / `DesktopBrowserEvent`） |
| `.../client/electron/ElectronWebviewPresentation.ts` | `createElement` 不再造 `<webview>`，改为造定位锚点（保留 `css.webview` 类维持布局、加 `data-sidebar-browser-anchor`、`name`/`partition` 属性）；`mount`/`present`/`show`/`clear`/`dispose` 语义不变；新增锚点 rect 变化通知 |
| `.../client/electron/ElectronWebViewImpl.ts` | 元素方法/事件换成桥调用；`observe()` 保持同步纯函数（读宿主推送的缓存快照，不能改成 `await state()`，`goBack`/`goForward`/`loadUrl`/`reload` 都靠同步快照做门控）；10 个 `did-*` 事件换成一个 `onEvent` 分发；补可见性信号；错误码映射（宿主错误 → Electron 语义，-3/`ERR_ABORTED` 视为用户取消不弹横幅）；rect 跟随不能用裸 `ResizeObserver` |
| `.../tests/`（4 个文件） | `electron-harness.client.ts`、`electron-frame.client.spec.ts`、`electron-lifecycle.client.spec.ts`、`apply.client.spec.ts` 随适配层改成假桥驱动 |

承载窗口里的导航状态：注入一段初始化脚本，patch `history.pushState`/`replaceState`/`go`/`back`/`forward` 维护 `{index, length}` 到 `window.__dshBrowserNav`，宿主用 `eval_with_callback` 读取 → 得到准确的 `canGoBack`/`canGoForward`，不需要引入 `objc2-web-kit` / `webview2-com` / `webkit2gtk` 三个平台依赖。

#### A3.4 composition 启用（`desktop/runtime/overlay.yml`）

```yaml
# Web ships the iframe-backed Browser tab; Desktop carries the same row in a
# native guest window instead.
- id: ui-sidebar-browser
  disabled: false
```

#### A3.5 融合度措施（用户要求「处理得更好一点」）

- 侧栏折叠/切 tab：监听 `transitionend` + 逐帧（折叠是 `transform` + `visibility:hidden`，不触发 `ResizeObserver`），判定不可见立即 `setVisible(false)`，不留露边
- 主界面弹层：`MutationObserver` 观察主文档 body 一级新增的浮层根节点（带 `role=menu`/overlay 标记）→ 临时隐藏承载窗口，关闭后恢复
- 拖拽/缩放：主窗口 `Moved`/`Resized` + 客户端测量双保险，逐帧跟随
- 视觉：`decorations(false)` + `shadow(false)` + 平台默认背景色与侧栏一致
- 焦点同步：点击页面区域时把侧栏活动面板状态同步过去（上游 dockkit 靠 webview 的 focus 事件切 `activePane`，见 `TabLayout.tsx:64-72`）

### A4. 坐标与跟随（可直接实现）

`WebviewWindow::inner_position()` 的语义是「窗口客户区左上角相对桌面」（tauri 源码 `webview_window.rs:1704`），而 webview 铺满客户区 → 不需要额外补偿标题栏/边框/WM 装饰：

```
physical_x = inner_position.x + rect.left   * scale_factor
physical_y = inner_position.y + rect.top    * scale_factor
physical_w = rect.width                     * scale_factor
physical_h = rect.height                    * scale_factor
```

`rect` 来自锚点 `getBoundingClientRect()`（CSS px，相对 webview 内容区），`scale_factor` 取主窗口 `scale_factor()`。

### A5. 必须真机验证（实现前先跑最小验证）

- macOS/Windows/Linux 各一次：悬浮窗能否正确落位、点击/键盘可用
- 主窗口拖拽/缩放时跟随是否可接受（有无甩尾/撕裂）
- 主界面下拉菜单被遮挡的实际程度（决定 A3.5-2 是否够用）
- `hide()` 后页面是否继续跑（timer/视频），切 tab 时复用 vs 销毁
- 侧栏折叠动画期间是否有露边

## B. 补齐 Electron 版缺失功能

共同地基：fork 现在只设了 `document.documentElement.dataset.dshDesktop`（`desktop/bridge/src/index.ts:4`），没有 `globalThis.dshDesktop`、没有 `data-platform`。上游客户端多处按 `'dshDesktop' in globalThis` 分流，所以这些 UI 现在全走在 Web 分支上。

### 批次 A：`dshDesktop` / `dshOnboarding` 注入 + 设备信息（地基，同一提交）

关键发现：上游的「欢迎页」在客户端包里已有等价实现（`ui-settings-account` 的 Desktop onboarding overlay），不需要移植 Electron 的 native 欢迎窗口——只要 `globalThis.dshDesktop` 存在就会自动启用。

- `desktop/bridge/src/index.ts`：定义 `dshDesktop`（含 `deviceInfo()`）、`dshOnboarding`（`hasApiKey()` 必需、`setActive()`）
- `desktop/runtime/src/sidecar.ts`：新增宿主请求 `credentials-present`（对应上游 `welcome-backend.ts` 的同语义 RPC，不暴露密钥值）与 `device-info`（`os.version()` / `cpus()[0].model` / `totalmem()`，格式照 `apps/desktop/src/device-info.ts`：`platform=…; os=…; app_arch=…; cpu=…; memory_gib=…`）
- `desktop/src-tauri/src/lib.rs`：透传命令；`capabilities/main.json` 加权限

验收：清空凭据后首次启动出现 onboarding；填 key/登录后进入工作区且不再出现；问卷 URL 的 `deviceInfo` 含 5 个字段且无主机名/密钥；bridge 注入顺序早于客户端模块执行。

### 批次 B：托盘常驻 + 关窗隐藏 + Windows 全屏 clearance

Tauri 核心能力（非插件）：`Cargo.toml` 给 tauri 加 `tray-icon` feature；`TrayIconBuilder` + `Menu`；关窗拦截用 `WindowEvent::CloseRequested` + `prevent_close()`；macOS 从 Dock 恢复用 `RunEvent::Reopen`。

新模块 `desktop/src-tauri/src/tray.rs`、`background_notice.rs`。

必须保留的上游语义：Windows 关窗=隐藏到托盘（首次弹确认，确认后写标记；取消则不写，下次仍问）；左键托盘=显示并聚焦；macOS 无托盘、关窗=隐藏、Dock 点击恢复；Linux 关窗=退出（上游仅 win32 有托盘）；隐藏全屏窗口前先退出全屏；退出前销毁托盘图标。

标记文件放 `app.path().app_config_dir()`（不写 Harness 数据目录）。

Windows 全屏：页面侧 `getCurrentWindow().onResized` + `isFullscreen()` 切 `data-fullscreen`，调整 bridge 现有的 `--dsh-frame-top-clearance`。

验收：Windows 真机——关闭→窗口消失、进程与 Host 存活、托盘仍在、再点恢复同一文档且不重载；删标记后首次关闭必须弹确认；干净退出后托盘图标消失。

### 批次 C：更新通道 + 后台轮询 + 静默提醒

新模块 `desktop/src-tauri/src/update_schedule.rs`：照抄上游 `update-schedule.ts` 的完成式调度（默认 600s、失败退避 ×2 上限 3600s、抖动 0.2、单飞、手动检查共享在飞请求）。

通知：官方 `tauri-plugin-notification` + `WebviewWindow::request_user_attention(UserAttentionType::Informational)`。

通道：`latest.json` 顶层加 `channel` 字段（CI 生成）；`UpdaterBuilder` 按通道选 endpoint。当前 fork 只有一条发布线，nightly 端点留空不算完成——需要产品决定是否真开第二条线。

必须保留：同一版本只提醒一次（per-version 记忆）；窗口已聚焦时不打扰；通知点击回到更新确认；后台失败不阻断前台。

验收：本地 feed 改 version 触发 badge；断网→退避且不弹错；未聚焦→一次通知；聚焦→无通知；调度器纯函数（退避/抖动边界、单飞）Rust 单测。

### 批次 D：强制更新（不可跳过的模态）

判据换成签名 feed 字段：CI 在 `latest.json` 顶层写 `mandatory: { "min_version": "x.y.z" }`，Rust 用 `Update.raw_json` 读；`current < min_version` → 建独立窗口承载模态（`CloseRequested` 一律 `prevent_close`、`always_on_top`、主窗 `set_enabled(false)`）。

新模块 `desktop/src-tauri/src/mandatory_update.rs` + `resources/shell/mandatory.html`。

新窗口不列入 capabilities 的 `windows`（拿不到任何能力）。

必须保留：非法 `min_version` 视为不强制（不能 fail open）；传输/解析失败保留已知 block；只有一次干净成功响应才解除。

验收：本地 feed 置 `min_version > 当前` → 启动即模态、关不掉、退出走正常退出确认；置回正常 → 正常启动。

### 批次 E：把 `dsh` 命令装进系统 PATH

无官方插件，需要原生实现：新模块 `desktop/src-tauri/src/cli_command.rs`（inspect/install/remove + 收据文件 + sha256 指纹 + 备份回滚，语义照抄上游 `command-installation.ts`）。

复用已有依赖：`tauri-plugin-dialog` 做三按钮确认（`MessageDialogButtons::YesNoCancelCustom`，对应 关闭/修复/移除）；Windows 改 PATH 用已在 `Cargo.toml` 的 `windows` crate 注册表 feature；macOS 提权复用上游做法（`/usr/bin/osascript ... with administrator privileges`）。

启动器：`desktop/runtime/src/cli.ts` 调 `runCli({ manageDesktopProfile: true, packageManager: … })`（`rt/.../dsh/lib/bin.js:254` 已导出 `runCli`），生成 POSIX sh + `dsh.cmd` 启动器。

必须保留：只管理自己写的链接（外部改动过 → `ESTALE` 拒绝）；安装后查询登录 shell 判断是否被别的 `dsh` 遮蔽；未打包/非安装位置只提示不装；更新安装中/退出中拒绝操作。

待定：Linux 是否支持（上游仅 macOS/Windows；可用 `~/.local/bin` 扩，需产品决定）。

未确认：Windows 上 Ctrl+C 转发（上游用 koffi 挂 `SetConsoleCtrlHandler`；我们不是 `ELECTRON_RUN_AS_NODE`，需实测）。

### 批次 F：`data-platform` + 设备本地快捷键

快捷键存储：Rust 侧读写 `app_config_dir()/keybindings.json`（不给 WebView 文件系统权限）；前端契约复用上游 `packages/client/shortcuts` 的 `ShortcutPersistence`。

按键拦截：Tauri 的 `WindowEvent` 没有 `KeyboardInput`（已核对 `tauri-2.11.5/src/app.rs`）→ 推荐在注入的 bridge 脚本里用捕获阶段 `keydown`/`keyup` + `preventDefault` 复刻上游算法（三平台一致、零新原生面）。

风险（必须单独验证）：一旦设 `data-platform`，客户端多处走 Desktop 分支——`shortcuts/src/client/index.ts:43-46` 在 `runtime==='desktop'` 时必须有 `dshDesktop.keyboard`，否则 throw；`ui-layout/src/client/AppFrame.tsx:168` 会按 darwin 去掉折叠图标栏；`ui-theme` 的 app-region 规则生效。所以 `data-platform` 要与 `dshDesktop.keyboard` 同一提交落地，且先单独做一次视觉验证。

做不到的：系统级快捷键（`Cmd`/`Ctrl+W` 等）无法像 Electron 那样在主进程拦截。

## C. 记录

Agent Note：`.agents/notes/implemented/architecture/2026-10-19-sidebar-browser-native-carrier.md`（+ `.zh.md` + `.i18n.yaml`），结构照 `2026-09-23-desktop-electron-comparison-adoptions.md`：

- Problem：上游用 Electron `<webview>`（Chromium OOPIF）；Tauri 系统 webview 无此能力
- Decision：独立无边框 `WebviewWindow` + 位置跟随；列出适配层改动
- Alternatives：`Window::add_child`（Linux `set_bounds` no-op、macOS 未修输入 bug、子 webview 永在最上层、`unstable` 改主 webview 创建方式、macOS `data_directory` 无效且 `clear_all_browsing_data` 会清主应用数据）——附证据链接；纯 iframe（`X-Frame-Options` 限制）
- 已知限制：不能被 CSS 裁剪、遮挡主窗口弹层、macOS 无法按 workspace 隔离存储

`AGENTS.md`：Sanctioned upstream surface change 段补第三项——`ui-sidebar-browser` 桌面适配层（3 个源文件 + 4 个测试），写明「只改承载方式、不改浏览器业务逻辑」。

同步预案：上述文件列入同步上游的手工复核清单。

## D. 风险与未确认

- 悬浮窗总在父窗口之上 → 遮挡主界面浮层（措施 2 只能缓解）
- macOS 上 `data_directory` 无效 → 无法按 workspace 隔离存储（Windows/Linux 可以）；绝不调用 `clear_all_browsing_data()`（那会清空主应用 Web 数据）
- Linux 的 `parent()` 走 gtk `transient_for`，WM 行为有差异（托盘/通知在 GNOME 下同理）
- 独立的第二方审查（floating-review-2）仍在进行，其结论到达后作为实现前的最后一道校验，有冲突则先修正计划

## 实施状态

实现期间与计划的偏差记在这里；上面的正文保持计划原样。

- **A**：`desktop/src-tauri/src/browser_window.rs` 已实现（`parent(main)` + `data_store_identifier`/`data_directory` + 注入式 `__dshBrowserNav` 历史追踪），适配层与假桥测试已改写；真机三平台验收未做。
- **B-A**：完成。`dshDesktop` / `dshOnboarding` 注入、`credentials-present` / `device-info` 宿主请求已落地。
- **B-B**：托盘常驻、关窗隐藏（首次询问并记忆，隐藏前退出全屏）、macOS `Reopen` 恢复已完成；`data-fullscreen` 由 bridge 统一发布，Windows 与 macOS 的顶部让位样式都读它。
- **B-C**：`desktop/src-tauri/src/update.rs` 取代计划的 `update_schedule.rs`，改为轮询 `latest.json` 单文件 feed（而非 `releases/latest` API），退避与 per-version 记忆保留；静默通知走 `tauri-plugin-notification`（`auto_cancel`），窗口聚焦时不打扰。页面侧原有的 GitHub API 自查已删除，About/徽标改为读 shell 的 feed 状态（`dshDesktop.release`），版本比较只在 Rust 有一份。nightly 通道不做，计划里已标注需要产品决定。
- **B-D**：`desktop/src-tauri/src/mandatory.rs` + `resources/shell/mandatory.html` 已实现，走无页面能力的独立窗口与 `mandatoryMinVersion` 判据；「一次干净响应才解除」改为在 feed 成功轮询时判据、非法版本不解除。
- **B-E**：`desktop/src-tauri/src/cli_command.rs` + `desktop/runtime/src/cli.ts` 已实现，Linux 支持 `~/.local/bin`；About 页提供安装/移除入口并显示落点与 PATH 状态。macOS 提权与 Windows Ctrl+C 转发未做（安装到 `~/.local/bin` 不需提权）。
- **B-F**：`keybindings.json` 读写命令、`dshDesktop.shortcuts` / `dshDesktop.keyboard`（DOM 转发）、`data-platform` 与 `dshDesktop.keyboard` 同批次落地——用户已确认按计划全做、keyboard 用 DOM 转发。
- **C**：Agent Note 三件套（`2026-10-19-desktop-capability-parity` 的 `.md` / `.zh.md` / `.i18n.yaml`）已写入 `implemented/architecture/`；`AGENTS.md` 的 Sanctioned upstream surface change 补上 `ui-sidebar-browser` 桌面承载面；`dsh-desktop-upstream-sync` 增加「复核三处授权面」清单。原计划里「给 `latest.json` 加 `channel` 字段 + `UpdaterBuilder` 选 endpoint」未做：只有一条发布线时该字段没有读取者，属于无消费者的抽象。

## 未完成 / 需人工决定

- 三个平台的托盘、全屏让位、悬浮窗定位、快捷键转发、强制更新窗口、`dsh` 安装都只有单平台实机验证（macOS 开发机）；Windows/Linux 需要在各自机器上跑一遍。
- 强制更新窗口当前只隐藏主窗；计划中的 `always_on_top` 与 `set_enabled(false)` 未加（隐藏已经让阻挡窗口成为唯一可操作面，再加置顶会把用户困在无法切换的窗口上）。
- `tauri-plugin-notification` 的点击回到更新确认未接：2.4.0 的桌面端没有点击回调，只能靠托盘/徽标把用户带回 About。

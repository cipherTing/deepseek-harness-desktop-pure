# Agent Note: 桌面能力对齐 Electron 产品层

Status: implemented

[English](2026-10-19-desktop-capability-parity.md) | 中文

## 问题

上游的 Electron 产品层（`apps/desktop`、`apps/desktop-host`）没有并入 DeepDive，因此它提供的每一项能力都必须在 `desktop/` 内重建，否则就根本不存在。其中两处缺口是结构性的，不只是外观差异。

上游 Electron 产品的侧边栏 Browser 标签使用 Electron `<webview>`：那是渲染进程可以像普通 DOM 元素一样定位的 Chromium 跨进程框架。DeepDive 的 Tauri 窗口没有这种元素，原先的 iframe 载体也无法加载返回 `X-Frame-Options: DENY` 的站点，包括 GitHub 和许多大型站点。现在 Tauri 载体通过原生 child WebView 承载这些页面。

其余缺口是“桌面信号”本身。上游客户端在 `globalThis.dshDesktop`、`document.documentElement.dataset.platform` 以及一条原生键盘通道上分支。缺少这三者时，同一份客户端会在桌面窗口里运行它的 Web 行为：没有桌面引导、没有托盘常驻、没有设备本地快捷键、没有更新提醒、`PATH` 里也没有 `dsh`。

## 决策

侧边栏 Browser 标签保留它页面侧的布局角色，放弃页面侧的内容角色。`ElectronWebviewPresentation` 创建定位锚点元素，而不是 `<webview>`。macOS 和 Windows 上，`browser_window.rs` 通过 Tauri 的 `Window::add_child` API 为每个标签持有一个 child `Webview`，该 API 由 `unstable` feature 启用；访客直接使用锚点相对客户区的矩形，并随主窗口一起移动。共享的浏览器业务逻辑——URL 规范化、历史可用性门控、标题与加载状态、标签生命周期——保持不变，被替换的只有承载方式。DeepDive Desktop 只支持 macOS 和 Windows，不支持 Linux。

访客状态在原生侧缓存，并以单条事件流（`desktop-browser-event`）推给页面，携带导航、标题、历史、焦点和主文档加载失败更新。每个平台都读取并操作自己的原生前进后退列表；一段精简的 WebKit 用户脚本负责报告原生导航回调看不到的同文档历史变化。首次请求地址会替换启动文档，因此 Back 不会返回空白页。Browser 会拒绝顶层导航到正在运行的应用，并按创建 guest 时配置的应用地址拦截请求。主文档加载失败会结束加载状态并显示 Browser 现有的本地化错误；用户取消的导航不显示错误。

访客会拒绝 WebKit 媒体采集权限、下载和原生弹窗；获准的 HTTP(S) 弹窗请求会打开 Sidebar 标签。DeepDive 按自己的下载策略处理，不跟随 Electron 的下载处理器。

child view 直接把页面报告的 CSS 像素矩形作为主窗口内的逻辑坐标，因此主窗口移动时由原生父子关系带动，不再更新屏幕坐标。

桌面信号现已完整。`dshDesktop` 暴露 `deviceInfo`、`browser`、`shortcuts`、`keyboard`；`dshOnboarding` 暴露 `hasApiKey` 与 `setActive`；`data-platform`、`data-fullscreen` 和 macOS 窗口材质由承载层发布。快捷键偏好是桌面配置目录下的设备本地文件，通过窄接口命令读写，而不是给 WebView 文件系统权限。

主文档继续在 capture-phase DOM listener 中匹配快捷键。原生键盘 hook 会处理发往 HTML 预览 frame 与 Browser guest 的按键，并在嵌入页面收到按键前进行匹配。两条路径都使用共享客户端已接受的绑定和 `installNativeKeyboard`；原生事件携带可信的 iframe 名称或 Browser guest lease，供客户端校验当前焦点载体。Browser guest lease 会选中其仍连接的 anchor 作为快捷键目标，但不会改变 DOM 焦点。guest 焦点通知会在该 anchor 上派发合成 focus 事件给 DockKit，同样不会改变 DOM 焦点或原生 WebView 焦点。

## 更新通道

发布时在 macOS 与 Windows 安装包旁发布一份 `latest.json` 资产，地址为 `releases/latest/download/latest.json`，因此它不会随 tag 变化。该文档携带版本号、双语发行说明、发布页地址、安装包链接，以及可选的 `mandatoryMinVersion`。承载层在后台轮询该 feed，轮询失败时把基础间隔翻倍直至一小时，并对每个版本只发一次通知（窗口处于焦点时绝不打扰）。高于当前安装版本的 `mandatoryMinVersion` 会打开一个加载内置文档、不持有任何页面能力的阻挡窗口；无法解析的值绝不会阻挡一个本来就没有途径获取替代版本的安装。

该 feed 只有一个读取者。「关于」页面与更新徽标向承载层索取它已经知道的事实，而不是自己去查发布站点，因此徽标与原生提醒不可能指向不同版本，页面也不再持有自己的版本比较与安装包命名规则。

调度状态的一半是它上次读到的 feed，因此一次失败的轮询会保留先前的答案，而不是撤回用户已经看到的版本。一次承载层无法完成的手动检查会被页面报告为失败，而不是「已是最新」。

## 键盘输入归属

Electron 通过 `before-input-event` 拦截 keydown 与 keyup。Tauri 没有跨平台共用的对应接口，因此每个平台在原生 WebView 输入位置安装 hook；主文档继续使用现有 DOM listener。匹配到嵌入页面中的快捷键后，载体会在 guest 或 iframe 收到该按键及对应的已消费释放事件前将其拦截，再由共享客户端校验可信的来源标识后分发。

## 考虑过的替代方案

**用 iframe 承载访客。** 没有需要定位和跟随的原生窗口，也没有额外进程。它无法加载任何拒绝被框入的站点，而那正是需求本身。

**在承载层重新实现快捷键文档格式。** 共享的 `ShortcutPersistence` 已经负责校验、冲突检测、revision 新鲜度与原子写入。bridge 从源码打包该协议模块而非复述它，因此编辑器接受的绑定就是承载层接受的绑定。

**通过 GitHub API 而不是发布资产读取版本信息。** 该 API 按 IP 限流、匿名调用，返回的载荷字段还需要承载层持续与发布流程保持同步。一份生成出来的资产把契约留在本就知道版本号、发行说明与策略下限的 workflow 里。

**从发行说明正文读取 `mandatory` 来阻挡更新。** 正文是面向人阅读的散文，策略字段属于机器读取的文档。无法解析或缺失的策略还必须让安装保持可用，而散文标记无法表达这一点。

## 后果

访客是原生 child view，不是 DOM 元素。页面 CSS 无法裁剪它或调整它的层级，因此承载层会在 DOM 命中检测发现锚点被浮层覆盖或锚点禁用 pointer events 时隐藏访客。

访客是原生 child WebView，既不是普通浏览器窗口，也不是 DOM 元素。页面读不到它的 DOM；Tauri host 只报告导航状态，并只接受限定范围的 guest 操作。Windows 会拒绝 WebView2 权限请求；macOS 13 及更新版本会拒绝 WebKit 媒体采集请求。应用地址保护、加载失败提示和 DockKit 焦点通知与 Electron Browser 行为保持一致；DeepDive 按自己的策略拒绝 guest 下载。Electron `<webview>` 与 preload 行为属于独立的 Electron 产品层，DeepDive Desktop 不使用它们。

同一个 Workspace 中的 Browser guest 共用内存存储分区；不同 Workspace 使用独立分区。DeepDive 在最后一个 tab 关闭后仍保留该分区，并在应用退出时释放，行为与 Electron 非持久化的 `session.fromPartition` 一致。macOS 为每个 workspace 共用一个通过 `nonPersistentDataStore` 创建的 `WKWebsiteDataStore`；Windows 为每个 workspace 保留一个 InPrivate WebView2 anchor。

`data-platform` 会同时切换多条共享规则：macOS 框架变为透明以透出原生侧边栏材质，折叠后的侧边栏不再有图标栏，窗口拖拽 recall 循环开始运行。若承载层只发布该标记而不配置窗口材质，会得到发白的侧边栏，这正是窗口透明度与效果必须与标记同一处配置的原因。

强制更新窗口是发布 feed 唯一的执行点。完全无法访问 feed 的构建永远不会知道自己被阻挡，这是有意的权衡：离线安装保持可用，而不是变成一个无路可退的失效安装。

`dsh` 安装会在 macOS 上写入 `~/.local/bin` 下的启动器，在 Windows 上写入 `LOCALAPPDATA` 并修改用户 `PATH`。它只会删除字节仍与自己写下的收据一致的启动器，因此用户替换过的启动器不会被改动。

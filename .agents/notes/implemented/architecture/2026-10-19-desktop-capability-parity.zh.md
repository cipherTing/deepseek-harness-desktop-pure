# Agent Note: 桌面能力对齐 Electron 产品层

Status: implemented

[English](2026-10-19-desktop-capability-parity.md) | 中文

## 问题

上游的 Electron 产品层（`apps/desktop`、`apps/desktop-host`）没有并入 DeepDive，因此它提供的每一项能力都必须在 `desktop/` 内重建，否则就根本不存在。其中两处缺口是结构性的，不只是外观差异。

侧边栏的 Browser 标签由 Electron 的 `<webview>` 承载：那是渲染进程可以像普通 DOM 元素一样定位的 Chromium 跨进程框架。Tauri 窗口没有这种元素，而本 fork 原先采用的 iframe 兜底无法加载任何返回 `X-Frame-Options: DENY` 的站点，GitHub 和大多数大型站点都在此列。于是用户真正会在这个标签里打开的站点，恰恰打不开。

其余缺口是“桌面信号”本身。上游客户端在 `globalThis.dshDesktop`、`document.documentElement.dataset.platform` 以及一条原生键盘通道上分支。缺少这三者时，同一份客户端会在桌面窗口里运行它的 Web 行为：没有桌面引导、没有托盘常驻、没有设备本地快捷键、没有更新提醒、`PATH` 里也没有 `dsh`。

## 决策

侧边栏 Browser 标签保留它页面侧的布局角色，放弃页面侧的内容角色。`ElectronWebviewPresentation` 现在创建的是一个定位锚点元素而不是 `<webview>`，`browser_window.rs` 为每个标签持有一个无边框 `WebviewWindow`，以主窗口为父窗口，并移动到锚点矩形处。共享的浏览器业务逻辑——URL 规范化、历史可用性门控、标题与加载状态、标签生命周期——保持不变，被替换的只有承载方式。

访客状态在原生侧缓存，并以单条事件流（`desktop-browser-event`）推给页面，携带 `load-started`、`load-finished`、`navigated` 和 `title`。页面继续读取同步快照，因为 `goBack`/`goForward`/`loadUrl`/`reload` 都依据当前的历史可用性做门控，无法等待一次往返。历史可用性自身来自一段初始化脚本，它改写 `history.pushState`/`replaceState`/`go`/`back`/`forward`，并通过 `eval_with_callback` 回答读取，因此不需要 `objc2-web-kit`、`webview2-com` 或 `webkit2gtk` 依赖。

定位公式是 `inner_position() + rect × scale_factor`：在 macOS 上窗口的 inner position 就是其客户区原点，而 WebView 铺满该区域，因此无需补偿标题栏或窗口装饰。主窗口的 `Moved` 与 `Resized` 事件在原生侧重算该算式，页面的逐帧跟随并行运行；这份重复是刻意的，因为 Tauri 每个拖拽步骤只投递一次移动，仅靠原生重算会出现可见滞后。

桌面信号现已完整。`dshDesktop` 暴露 `deviceInfo`、`browser`、`shortcuts`、`keyboard`；`dshOnboarding` 暴露 `hasApiKey` 与 `setActive`；`data-platform`、`data-fullscreen` 和 macOS 窗口材质由承载层发布。快捷键偏好是桌面配置目录下的设备本地文件，通过窄接口命令读写，而不是给 WebView 文件系统权限。

键盘输入从 DOM 转发。Tauri 的 `WindowEvent` 在任何平台都不包含键盘输入，因此在捕获阶段用一对 `keydown`/`keyup` 把每次按键对照 Electron 主进程构建的同一份绑定索引解析，当某个命令认领该按键时调用 `preventDefault`，并把结果交给客户端的 `installNativeKeyboard`。这条路径限定在 macOS 与 Windows——共享客户端正是在这两个平台以“原生输入拥有可配置绑定”的方式安装自己的分发器；在 Linux 上 DOM 路径本身就会投递全部可配置绑定。

## 更新通道

发布时在安装包旁发布一份 `latest.json` 资产，地址为 `releases/latest/download/latest.json`，因此它不会随 tag 变化。该文档携带版本号、双语发行说明、发布页地址、按平台给出的安装包链接，以及可选的 `mandatoryMinVersion`。承载层在后台轮询该 feed，轮询失败时把基础间隔翻倍直至一小时，并对每个版本只发一次通知（窗口处于焦点时绝不打扰）。高于当前安装版本的 `mandatoryMinVersion` 会打开一个加载内置文档、不持有任何页面能力的阻挡窗口；无法解析的值绝不会阻挡一个本来就没有途径获取替代版本的安装。

该 feed 只有一个读取者。「关于」页面与更新徽标向承载层索取它已经知道的事实，而不是自己去查发布站点，因此徽标与原生提醒不可能指向不同版本，页面也不再持有自己的版本比较与安装包命名规则。

调度状态的一半是它上次读到的 feed，因此一次失败的轮询会保留先前的答案，而不是撤回用户已经看到的版本。一次承载层无法完成的手动检查会被页面报告为失败，而不是「已是最新」。

## 为什么用 DOM 转发键盘

Electron 在主进程拦截匹配的按键，渲染进程根本看不到它，也就无法再次触发该命令。Tauri 承载层没有对应的钩子。从捕获阶段监听器转发复现了真正重要的两个性质——命令只执行一次、页面不会同时对按键作出反应——且不引入原生输入面、平台相关的键码表，也不产生第二份“一次按键意味着什么”的事实来源。代价是转发器看不到投递给内嵌框架的输入，因此在内嵌 HTML 预览或浏览器访客里按下的快捷键不会被全局命令认领。

## 考虑过的替代方案

**用 `Window::add_child` 承载访客。** 这是把一个 WebView 叠在另一个窗口之上的官方做法，且需要 `unstable` feature。Linux 上的 `set_bounds` 是空操作，子 webview 永远画在父窗口之上，两个已知输入缺陷（[tauri#8705](https://github.com/tauri-apps/tauri/issues/8705)、[tauri#10194](https://github.com/tauri-apps/tauri/issues/10194)）正是在该模式下复现。启用 `unstable` 还会改变主 webview 的创建方式。

**用 iframe 承载访客。** 没有需要定位和跟随的原生窗口，也没有额外进程。它无法加载任何拒绝被框入的站点，而那正是需求本身。

**通过平台输入 API 做原生按键拦截。** 它能看见内嵌框架内的输入。代价是新增一层原生权限面、三份平台实现，以及一套必须与共享协议同步演进的键码映射；而共享客户端的键盘适配器本就是针对 preload 校验过的输入写的，不是针对平台事件流。

**在承载层重新实现快捷键文档格式。** 共享的 `ShortcutPersistence` 已经负责校验、冲突检测、revision 新鲜度与原子写入。bridge 从源码打包该协议模块而非复述它，因此编辑器接受的绑定就是承载层接受的绑定。

**通过 GitHub API 而不是发布资产读取版本信息。** 该 API 按 IP 限流、匿名调用，返回的载荷字段还需要承载层持续与发布流程保持同步。一份生成出来的资产把契约留在本就知道版本号、发行说明与策略下限的 workflow 里。

**从发行说明正文读取 `mandatory` 来阻挡更新。** 正文是面向人阅读的散文，策略字段属于机器读取的文档。无法解析或缺失的策略还必须让安装保持可用，而散文标记无法表达这一点。

## 后果

访客窗口永远画在父窗口之上。页面侧在侧边栏上方展开的浮层——设置菜单、输入框的拾取器——在跟随循环判定锚点离屏或切换到其他标签之前都会被访客遮住；承载层无法把原生窗口裁剪到某个 CSS 区域。

访客是一个普通浏览器窗口，页面读不到它的 DOM。导航、标题与历史可用性就是全部契约，Electron 访客通过 preload 上报的其他信息在这里没有对应物。

`data-platform` 会同时切换多条共享规则：macOS 框架变为透明以透出原生侧边栏材质，折叠后的侧边栏不再有图标栏，窗口拖拽 recall 循环开始运行。若承载层只发布该标记而不配置窗口材质，会得到发白的侧边栏，这正是窗口透明度与效果必须与标记同一处配置的原因。

键盘转发只覆盖 macOS 与 Windows。在 Linux 上，可配置绑定继续通过客户端的 DOM 分发器送达，因此在 macOS 上录制的双键和弦在 Linux 上不会被认领。

强制更新窗口是发布 feed 唯一的执行点。完全无法访问 feed 的构建永远不会知道自己被阻挡，这是有意的权衡：离线安装保持可用，而不是变成一个无路可退的失效安装。

`dsh` 安装会在 macOS 与 Linux 上写入 `~/.local/bin` 下的启动器，在 Windows 上写入 `LOCALAPPDATA` 并修改用户 `PATH`。它只会删除字节仍与自己写下的收据一致的启动器，因此用户替换过的启动器不会被改动。

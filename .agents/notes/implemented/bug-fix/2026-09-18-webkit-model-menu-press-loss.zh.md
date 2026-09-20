# Agent Note: 恢复 WebKit 上的模型菜单行点击

Status: implemented

[English](2026-09-18-webkit-model-menu-press-loss.md) | 中文

## Problem

在 `0.1.6-alpha.2` 内核中，展开某个面板后，编辑器的模型菜单会把键盘焦点交给当前使用中的那一行。WebKit 在按下 `<button>` 时不会给它焦点，因此按下另一行会让焦点离开当前聚焦行，并且不报告 related target。卡片的失焦保护把这种情况读作「焦点离开了卡片」，于是在按下过程中直接关闭卡片，导致该行在 `click` 之前就被卸载 —— 于是不会发出 `session.selectModel`，模型也不会切换。所有行都受影响，而 macOS 版 DeepDive Desktop 使用的正是 WebKit 引擎；Chromium（即 Windows 的 WebView2）会把焦点交给被按下的行，因此走不到这条分支。上游报告与其中的分析见 [deepseek-ai/deepseek-harness#6997](https://github.com/deepseek-ai/deepseek-harness/discussions/6997) 与 [#7002](https://github.com/deepseek-ai/deepseek-harness/discussions/7002)。

## Decision

Portal 出来的菜单卡片只取消「按下」这一次的焦点移动，而且只针对落在卡片内按钮上的按下：当事件目标位于某个 `button` 内时，`onMouseDown` 调用 `preventDefault()`。点击照常触发，获得焦点的行保持焦点，卡片的失焦保护与按键处理完全不变。落在卡片自身装饰元素上的按下没有可聚焦对象，保持浏览器默认行为。这一写法沿用 `ui-directory-picker-browse` 中已有的按下保护，那里的行同样抑制这种焦点抢移。

## Verification

组件测试驱动真实指针会产生的动作：展开模型面板后，按下某一行会被默认阻止、该行保持挂载，按下卡片装饰元素不受影响，随后的点击完成模型选择。该测试在未修复的组件上失败，在修复后通过。

另用一个临时 Playwright 场景，通过真实 web scaffold 分别驱动构建产物，用真实指针点击该行并读取触发器上的文案：

| 引擎 | 未修复 | 已修复 |
| --- | --- | --- |
| WebKit 26.5（macOS WebView） | 触发器仍停留在起始模型 | 选中被按下的那一行 |
| Chromium（Windows WebView2） | 选中被按下的那一行 | 选中被按下的那一行 |

本包的菜单、portal、键盘、目录与选择相关测试保持通过，仓库 lint 与类型检查通过。

## Alternatives considered

- **忽略没有 related target 的失焦。** 卡片会保持打开，但焦点已经落到页面 body，卡片自身的按键处理再也看不到按键，Esc 与方向键会一直失效，直到再次点击触发器。它还会改变 Chromium 的行为 —— 那里按下卡片装饰元素目前会关闭菜单。

- **完全去掉失焦关闭。** 菜单本来就会在外部按下、Esc 和选择完成后关闭，但同样会改变 Chromium 的行为；而且任何其他会给自身行聚焦的卡片，距离 WebKit 上的同类失败也只有一次被取消的焦点移动之遥。

## Consequences

模型菜单在 WebKit 引擎（包括 macOS Desktop 构建）上重新可以用鼠标选择，同时不改变 Chromium 行为，也不改变为面板展开新增的键盘模型。这是一处临时的 fork 侧补丁：处理函数带有注释并指明上游报告，待同步带来上游自己的修复时，采纳上游修复并删除该处理函数。

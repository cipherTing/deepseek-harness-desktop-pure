# Agent Note: 忽略单次 Desktop 更新提醒

Status: implemented

[English](2026-09-18-desktop-ignore-update-reminder.md) | 中文

## Problem

Desktop 的更新按钮位于设置入口下方，它打开的版本弹窗只提供「稍后」和「开始更新」。有意停留在当前安装版本的用户因此每次启动都会看到同一条提醒，只有装上该版本才能让它消失。

## Decision

版本弹窗新增第三个操作「忽略本次版本」，并在其旁注明更新仍然可用的位置：设置 → 关于 DeepDive。忽略只对当前这个版本隐藏更新按钮；下一次轮询发现不同版本时按钮立即回来，About 一节保持原样，照旧报告发现的版本并提供自己的「查看更新」入口，这条路径正是该说明文案所指。

该偏好是 `desktop-ui` 设置命名空间中的一个持久字段 `ignoredUpdateVersion`。`@deepseek-ai/dsh-desktop-client-ui` 的 Host 半边注册该命名空间，浏览器半边通过 `ctx.settingsScope` 绑定它，因此该值与其余偏好同处一份用户设置文档，并能跨重启保留。写入经由带认证的 settings Remote 命名空间；Desktop 载体不新增 HTTP 路由、不新增 Tauri 命令，也不新增第二套配置存储。没有任何界面会清除该字段，因此在新版本出现之前，直接编辑设置文档是恢复提醒的唯一方式。

更新按钮按精确版本字符串比较被忽略的版本。因此该抑制不会超出它所指向的那个版本，恢复提醒也不需要与已安装版本做比较。

## Verification

Desktop 的 Node 测试覆盖新增的弹窗操作与其说明文案、操作后按钮消失、写入的版本，以及被忽略版本保持安静而更新的版本仍显示按钮。Desktop 组合测试固定客户端 bundle 声明的注入，仓库门禁覆盖新增的包依赖。

## Alternatives considered

- **写入 WebView 的 `localStorage`。** 拒绝，因为 sidecar 每次启动都绑定随机 loopback 端口，页面 origin 随之变化，该存储区无法跨重启保留。

- **写入 Tauri 应用数据目录下由 Desktop 自有的文件。** 拒绝，因为这属于用户配置，已由共享设置文档承载；第二套存储还需要新的 Tauri 命令与 capability。

- **抑制所有小于等于被忽略版本的版本。** 拒绝，因为精确匹配才表达用户的选择，而任何更新的版本都必须继续提供。

## Consequences

提醒现在由用户控制，同时不削弱更新路径：About 一节照旧检查、照旧报告、照旧发起安装。更新按钮是唯一遵循该偏好的组件，因此未来若要展示可用性的表面，必须读取同一命名空间，而不是从版本源重新推导。

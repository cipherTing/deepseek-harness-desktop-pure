# Agent Note: Desktop 适配 DeepSeek Harness 0.1.7-alpha.1

Status: implemented

[English](2026-09-22-desktop-sync-dsh-0.1.7-alpha.1.md) | 中文

## Problem

DeepDive 需要接入官方 tag `dsh-v0.1.7-alpha.1`，精确提交为 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`，同时保留独立的 Tauri Desktop 产品，以及它所携带的 Desktop 增量。

本次上游范围包含 Harness 包、客户端表面、设置基础设施与文档变动，也继续扩展位于 `apps/desktop` 与 `apps/desktop-host` 的官方 Electron Desktop 产品。

## Decision

经审查的集成树通过真实的无提交合并应用上游 `dsh-v0.1.7-alpha.1`，并保留 fork 自有的 Desktop 增量。共享 Harness 包与已批准的客户端 seam 被接入；Electron 产品层、被搬移的工作区资源、其治理笔记、其宿主测试以及 `@electron/osx-sign` 补丁条目均被排除。DeepDive 继续只保留 `desktop/` 下的单一 Tauri 实现。共享客户端包保留它们为各种宿主发布的浏览器侧载体实现，包括基于 Electron 的 Browser 载体，因为这些文件属于这些包自身的构建与测试；不引入任何 Electron 宿主、打包、发布代码或依赖。

同步分支从同步前的 `master` 尖端开始，其集成合并把经验证的上游 tag 记为第二父提交。

上游把固定的解释器／Office payload 工具从 Electron 目录移到了 `scripts/primary-runtime/`，exe、wheel 与 CI 构建都消费它。该工具是共享的，因此本 fork 现在保留它，第三方声明生成器也保留其运行时锁的披露；先前"去掉该输入"的 fork 适配随之退役，`lefthook.yml` 改为监听共享路径。

上游把客户端设置服务 `settingsScope` 更名为 `configForms`，并把偏好迁移到每个插件条目自己的配置表单。Desktop 客户端 UI 同时跟进这两点：其 Host 半边声明该条目的 `Config` 并让该条目不出现在自动生成的设置页中，浏览器半边读写同一个条目表单。About 页面与更新徽标的行为保持不变。

上游把固定的设置触发器替换为 `settings.launcher` 座。外壳采用该座，并在其下方保留 fork 的 `settings.update` 座与触发器列，因此 Desktop 更新徽标仍按本 fork 的位置渲染。

异步 Session 导出保存载体在 `session-log-export` 中保留；上游的纯浏览器下载会丢掉原生 Session ZIP 保存。仅属于 Electron 的测试用例继续从 `plugin-manager` 的 manager 测试、`ui-directory-picker-native` 的客户端测试以及 `apps/web/tsconfig.json` 中移除。

本 fork 为 `dsh-v0.1.6-alpha.2` 加入的 WebKit 模型菜单按下修复在本次集成后仍然保留；该文件里上游的图标改名已被吸收，而该修复仍然必要，因为上游尚未发布自己的修复。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.7-alpha.1`；根 README 标注集成的内核为 `0.1.7-alpha.1`。本次集成不改变独立的 DeepDive Desktop 版本。

上游用安装范围内的运行时解析取代了按 profile 建立的模块回退链接与 `resolutionMode` 选项，该解析在任何插件导入之前完成。sidecar 现在自行加载共享 `web` profile，并以部署运行时清单——也就是本载体自己的安装——为锚点通过 `resolvedProfile` 启动它，因此该解析同时包含 Harness 闭包与本 fork 的 Desktop 运行时包，而且不会在 Harness home 下写入任何回退链接。Desktop Settings Controller 跟进上游收窄后的 internals 契约，只传入由 Tauri 承载的 `openTextFile`；被移除的 `openPath`、`canOpenPath` 覆盖与其自有 `Config` 随旧契约一起退役。

上游 Electron 包集合挑选 Desktop 闭包时同时遍历 `dependencies` 与 `peerDependencies`。本 fork 的部署闭包由运行时清单决定，因此新的账号包所依赖、且仅为 peer 的 `@deepseek-ai/dsh-deepseek-account` 现在声明在其中；缺少它时打包的账号行无法导入，凭证表面会一直处于 pending。

上游关于 Windows Electron 打包与更新的笔记（`2026-09-17-windows-runtime-signature-cache`、`2026-09-17-windows-signature-completion`、`2026-09-20-windows-embedded-mandatory-update`）依赖被排除的 Electron 决策，随它们一起离开本树；归档 manifest 移除被排除的 `2026-09-16-movable-mandatory-update-window` 三元组的封存，已记录的 unknown 断言清单移除其 `apps/desktop` 条目。引用了被排除层的共享笔记、包 README、测试与开发文档改为直接称呼 Electron 产品，或写明本 fork 自己的命令：primary-runtime 测试保留仓库包管理器固定版本、去掉 Electron 载体比对，可执行源码白名单去掉 Electron 公证包装脚本，Makefile 与被附加的上游命令清单则写明本 fork 的 Desktop 命令。

Session 导出保存载体沿用上游的文档相对路由，并以载体的返回结果决定状态；Desktop 页面桥接在交给 Rust 命令之前按文档 base 解析该路由，Rust 再按当前 loopback origin 校验该请求。

## Alternatives considered

- **把 fork 重置到上游 tag，或按目录挑选复制**——拒绝，因为这会绕过对重叠行为的审查，并丢失连续的 fork 历史。

- **在 Tauri 之外同时接入官方 Electron Desktop**——拒绝，因为这会造出第二个 Desktop 产品、打包路径与运行时归属模型。

- **随 Electron 目录一起丢掉共享的 primary-runtime 工具**——拒绝，因为 exe、Python wheel 与 CI 构建独立于 Electron 消费它。

- **重新加回被移除的 `settingsScope`，而不是跟进改名**——拒绝，因为上游的服务承载着实时设置传输；fork 自建副本会让设置路径分叉。

## Consequences

同步后的树以经验证的 0.1.7-alpha.1 提交为祖先，相对该 tag 只领先不落后，并保留经审查的 Tauri Desktop 增量。官方 Electron 产品仍在本 fork 的 Desktop 工作区之外。

## Verification

上游远端 tag 解析为 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`，手工合并没有遗留未解决路径。经审查的树通过 `pnpm install`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test:docs`、`pnpm run hygiene`、`pnpm run build`，以及 Desktop 运行时构建与其 Node 测试；其中自带的 sidecar 冒烟测试在两种启动方式下都会在 loopback 主机上启动实际打包树，并在任何组合行未能激活时失败。合并触及的每个单元测试单独运行均通过；整轮单元测试的其余失败可复现为对负载敏感的超时，单独运行即通过。

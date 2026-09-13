# Agent Note: Desktop 适配 DeepSeek Harness 0.1.2-alpha.5

Status: implemented

[English](2026-09-03-desktop-sync-dsh-0.1.2-alpha.5.md) | 中文

## Problem

DeepDive Desktop 发行版需要适配官方 `dsh-v0.1.2-alpha.5`，精确提交为 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，同时不能丢失 Tauri carrier、DeepDive 品牌、About 页面、更新入口、受限拖拽反馈和原生 Session 导出载体。

自 `dsh-v0.1.2-alpha.3` 以来，上游修改了客户端渲染和 slot 元数据、会话事件标识、projection cache 恢复、包目录、生成产物和文档。因此 fork 需要一棵经过审查的集成树，不能 reset 到上游或按目录复制。

## Decision

经过审查的 `0.1.11` 树从已验证的 alpha.5 提交开始，只在其上保留完整的 fork 增量。本地手工集成分支只作为内容审查锚点。已发布的 `master`、`v0.1.10` 及其历史保持不变。

上游拥有的 Harness 行为、包元数据、lockfile 更新、快照和包删除均采用 alpha.5 结果。清理步骤移除 alpha.5 删除的两个旧包遗留在本地的、被 Git 忽略的 `lib/` 和 `node_modules/`；不会恢复这些已删除的包，也不会放宽 workspace 层级校验。

Desktop 只保留 carrier 和两处已批准的非 `desktop/` 改动：Web 为空的 `settings.update` seat，以及异步 Session 导出保存载体。目标 slot catalog 仍提供 `sidebar.brand.name`、`settings.section` 和 `settings.update`。Desktop client 插件会等待 locale 和 slots 服务，再注册这三项贡献。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.2-alpha.5`。Desktop 包元数据为 `0.1.11`，上游根版本继续保持 `0.1.2-alpha.5`。

## Alternatives considered

- **reset 到 alpha.5，或按 Desktop 白名单替换整棵树**——不采用，因为这两种做法都会隐藏上游变更与 fork 行为之间的重叠。

- **为了让脏的本地构建目录通过校验而保留上游已删除的包**——不采用，因为这些目录只是被忽略的构建残留，不是 alpha.5 源码包；`pnpm run clean` 可以安全移除。

- **静态检查通过后跳过 runtime 和浏览器组装验证**——不采用，因为此前的客户端插件生命周期回归曾让 DeepDive 品牌和 About 入口消失，而源码和 bundle 校验依然通过。

- **rebase 或 force-push 已发布的 `master`**——不采用，因为已发布的 `master` 和 release tag 不改写。基于上游的候选拓扑可以单独准备；后续获准落地时，通过正常 merge 保留连续的 `master` 线。

## Consequences

Desktop runtime 使用 alpha.5 的当前 web profile，并在真实组装后的浏览器 UI 中显示 DeepDive。设置导航中包含 About DeepDive，模拟存在更新时会显示 Desktop 更新控件。Web 不提供更新贡献，默认仍使用浏览器下载载体。

fork 在 alpha.5 之上保留已审查的 Desktop 增量，alpha.5 是 `0.1.11` 的祖先。后续可以测试或发布该分支，不需要改写已发布分支。

## Verification

上游远端 tag 解析为 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，手工 no-commit merge 没有未解决路径。审查树已通过 `pnpm run clean`、`pnpm run build`、`pnpm --filter @deepseek-ai/dsh-desktop run build:runtime`、`pnpm run hygiene`、`pnpm desktop:version:check`、30 个 Desktop Node 测试、Desktop typecheck 和 Desktop lint。

无头浏览器通过 bundled Node executable 启动已部署的 sidecar，完成上游 beta 提示，并确认已渲染 DeepDive 品牌、`0.1.11` 版本、alpha.5 内核版本、更新控件、About DeepDive 入口和 About 页的检查更新操作，且没有浏览器错误。

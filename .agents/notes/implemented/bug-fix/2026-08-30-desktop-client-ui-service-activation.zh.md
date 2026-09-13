# Agent Note: Desktop 客户端 UI 服务激活

Status: implemented

[English](2026-08-30-desktop-client-ui-service-activation.md) | 中文

## Problem

针对上游 tag `dsh-v0.1.2-alpha.1`（版本 `0.1.2-alpha.1`）适配的 Desktop 浏览器 bundle 使用可选的 `ctx.get()` 读取 `locale` 和 `slots`，却没有声明任何 Cordis 服务。如果 bundle 在任一服务提供方出现前运行，就会直接返回，不注册 DeepDive 品牌、About 页面、更新入口或 Desktop 拖拽反馈。此时 fiber 没有生命周期依赖，后续也不会再次激活。

## Decision

Desktop 客户端插件在运行时 `inject` 列表中声明 `locale` 和 `slots`，并通过已声明的上下文属性读取它们。Cordis 会在两个服务都存在前保持插件 pending，并在服务提供方消失后重新出现时重新加载插件。各项贡献仍通过 `slots.inject()` 注册，使每个注册跟随其声明 slot 的生命周期，具体规则见 [slot 声明注入](../../archived/architecture/2026-08-05-slot-declaration-injection.md)。

包级 `dsh.client.inject` 元数据将真正提供 renderer-owned `slots` 服务的包记录为 `@deepseek-ai/dsh-client-ui-renderer`。这项元数据不能替代运行时服务声明。不需要修改 Harness 核心、renderer 或附件接纳逻辑。

## Alternatives considered

**继续使用可选的 `ctx.get()`，服务缺失时直接返回。** 不采用。启动竞态会变成静默且永久不完整的插件。

**增加定时器或自定义重试循环。** 不采用。服务等待、重载和销毁已经由 Cordis 负责，第二套生命周期会带来重复注册和清理风险。

**修改共享 renderer 或 slot registry。** 不采用。现有服务已经提供所需能力，缺陷属于 Desktop 消费方的依赖声明。

**只依赖 `dsh.client.inject`。** 不采用。包级依赖图元数据不能保证 Cordis 插件在服务提供方准备好后完成激活。

## Consequences

DeepDive 品牌、About 页面、更新入口和 Desktop 拖拽反馈共享同一个明确的服务生命周期。Desktop 仍是低侵入 overlay，文件接纳、草稿创建和提交仍由 DSH 唯一负责。生命周期回归测试使用真实构建的 Cordis fiber，并在插件创建后再提供服务。

## Verification

`desktop/tests/update-ui.test.mjs` 验证插件在获得 `locale` 和 `slots` 前不会注册任何内容，两个服务提供后才注册 `settings.section`、`settings.update` 和 `sidebar.brand.name`。Desktop 源码测试和部署 runtime 测试继续覆盖 About/更新 UI 以及 DSH 拖拽事件传播不变。

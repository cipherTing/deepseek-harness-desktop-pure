# Agent Note: Desktop client UI service activation

Status: implemented

English | [中文](2026-08-30-desktop-client-ui-service-activation.zh.md)

## Problem

The Desktop browser bundle adapted to upstream tag `dsh-v0.1.2-alpha.1` (version `0.1.2-alpha.1`) read `locale` and `slots` with optional `ctx.get()` while declaring no Cordis services. If the bundle ran before either provider existed, it returned without registering the DeepDive brand, About section, update seat, or Desktop drag feedback. The fiber then had no lifecycle dependency that could activate it again.

## Decision

The returned Desktop client plugin declares `locale` and `slots` in its runtime `inject` list and reads them through the declared context properties. Cordis keeps the plugin pending until both services exist and reloads it when a provider disappears and returns. Contributions still use `slots.inject()` so each registration follows the declaring slot's lifetime, as specified by [slot declaration injection](../../archived/architecture/2026-08-05-slot-declaration-injection.md).

The package-level `dsh.client.inject` metadata names `@deepseek-ai/dsh-client-ui-renderer` as the package that provides the renderer-owned `slots` service. That metadata does not replace the runtime service declaration. No Harness core, renderer, or attachment-admission behavior changes are required.

## Alternatives considered

**Keep optional `ctx.get()` and return when a service is missing.** Rejected because a startup race becomes a silent, permanently incomplete plugin.

**Add a timer or a custom retry loop.** Rejected because Cordis already owns service waiting, reload, and disposal; a second lifecycle would create duplicate registration and teardown risk.

**Change the shared renderer or slot registry.** Rejected because those services already provide the required behavior. The defect belongs to the Desktop consumer's declaration.

**Rely on `dsh.client.inject` alone.** Rejected because package graph metadata does not guarantee Cordis plugin activation after the service providers are ready.

## Consequences

DeepDive branding, the About section, the update seat, and Desktop drag feedback share one explicit service lifetime. The Desktop package remains a low-intrusion overlay, and DSH remains the sole owner of file admission, draft creation, and submission. The lifecycle regression test exercises a real built Cordis fiber with providers supplied after plugin creation.

## Verification

`desktop/tests/update-ui.test.mjs` verifies that the plugin remains unregistered until `locale` and `slots` are supplied, then registers `settings.section`, `settings.update`, and `sidebar.brand.name`. Desktop source and deployed runtime tests continue to cover the About/update UI and unchanged DSH drag propagation.

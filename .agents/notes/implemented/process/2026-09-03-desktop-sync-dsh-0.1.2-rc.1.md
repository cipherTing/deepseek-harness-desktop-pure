# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.2-rc.1

Status: implemented

English | [中文](2026-09-03-desktop-sync-dsh-0.1.2-rc.1.zh.md)

## Problem

The unreleased DeepDive `0.1.11` candidate must adopt upstream tag `dsh-v0.1.2-rc.1` at `a66e4702047846cdaa10c66c9d3df3951f5ea70d` without changing the fork-owned Tauri carrier, DeepDive brand, About page, update entry, scoped drag feedback, or native Session export carrier.

The rc.1 range after `dsh-v0.1.2-alpha.5` updates 252 upstream package version fields and no Harness source, workflow, lockfile, or Desktop path. The small range still needs a real integration because the package metadata is part of the bundled runtime closure.

## Decision

The reviewed local `0.1.11` candidate starts at the verified rc.1 commit and carries the same reviewed fork delta above it. The remote `origin/0.1.11` remains the earlier alpha.5 candidate until an explicitly authorized force-with-lease update; published `master`, `v0.1.10`, and their history remain unchanged.

All upstream package manifests use `0.1.2-rc.1`. The root manifest retains the fork's Desktop workspaces and commands while taking the rc.1 root version. Desktop remains `0.1.11` because no `v0.1.11` tag or GitHub Release exists.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.2-rc.1`. The target preserves the approved `settings.update` seat, native Session-export save carrier, and client UI service injection for the DeepDive brand, About section, and update control.

## Alternatives considered

- **Treat the package-version-only range as a reason to skip manual integration** — rejected because release metadata controls the runtime closure and must be reviewed with the fork's root manifest.

- **Bump Desktop to `0.1.12`** — rejected because `0.1.11` has no release tag or GitHub Release and remains the same unreleased Desktop candidate.

- **Push the rebuilt branch immediately** — rejected because the existing remote branch points to the alpha.5 candidate; replacing it requires a separate explicit authorization and exact force-with-lease.

## Consequences

The local `0.1.11` candidate records rc.1 as its upstream ancestor while preserving the verified Desktop behavior. It is intentionally different from `origin/0.1.11` until the rc.1 candidate receives its own remote validation and an authorized remote update.

The alpha.5 branch packaging run remains evidence only for the earlier SHA. rc.1 requires its own build and runtime verification before any later push or release decision.

## Verification

The upstream remote tag resolves to `a66e4702047846cdaa10c66c9d3df3951f5ea70d`, and alpha.5 is its ancestor. A real no-commit merge from the verified `0.1.11` alpha.5 candidate has no unresolved paths. All 251 non-root changed upstream manifests match rc.1 exactly; the root manifest combines the rc.1 version with the fork-owned Desktop workspaces and commands.

The reviewed tree passes `pnpm run clean`, `pnpm run build`, runtime deployment, hygiene, Desktop version validation, 30 Desktop Node tests, 9 Desktop Rust tests, Desktop typecheck, and Desktop lint. A headless browser starts the deployed bundled sidecar, renders DeepDive `0.1.11` with Harness kernel `0.1.2-rc.1`, and verifies the update control, About DeepDive entry, and About-page update action without browser errors.

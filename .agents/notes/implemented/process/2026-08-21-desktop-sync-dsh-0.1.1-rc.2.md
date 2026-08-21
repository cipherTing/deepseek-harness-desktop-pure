# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.1-rc.2

Status: implemented

English | [中文](2026-08-21-desktop-sync-dsh-0.1.1-rc.2.zh.md)

## Problem

The Desktop fork must track the upstream `dsh-v0.1.1-rc.2` release without turning the independent DeepDive carrier into an upstream product variant or changing its Desktop version.

## Decision

This fork is adapted to the upstream `dsh-v0.1.1-rc.2` tag at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The synchronization stays on the existing `codex/sync-dsh-v0.1.1-rc.2` branch and is reviewed in complexity-ordered batches. Desktop keeps its independent `0.1.6` version and remains a carrier around the upstream Web profile.

The rc2 source, tests, package metadata, generated references, and bilingual documentation are synchronized while the fork keeps its DeepDive branding and Desktop-only changes. The root brand README files remain fork-owned. The upstream `SubagentHeaderLineage` files are intentionally excluded because this fork already removes the lineage slot and uses its existing `SubagentCatalogAction` surface; restoring only those files would leave incompatible dead code and change the fork UI.

## Alternatives considered

- **Restore the complete upstream lineage UI chain** — rejected because it changes the fork's existing subagent header behavior and expands the sync beyond Desktop adaptation.
- **Keep the unused lineage files and add only their dependencies** — rejected because the fork's contracts, locale slots, and props do not provide the upstream component's required surface; the package typecheck fails.
- **Create a second temporary integration branch** — rejected because the existing sync branch is the maintained work surface.

## Consequences

The fork receives the upstream `0.1.1-rc.2` updates while retaining DeepDive branding, Desktop `0.1.6`, and the Tauri carrier boundary. No Harness runtime behavior is changed for Desktop-only reasons. Windows packaging remains a CI responsibility; this macOS host does not attempt a Windows build.

## Verification

The synchronization passes the targeted host build, type-equivalence and generated-catalog checks, documentation-site checks, Markdown link checks, bilingual pairing checks, and the `ui-subagent` TypeScript check. The rc2 tree audit reports no missing upstream paths outside the intentional fork-owned brand and UI differences.

# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.1-rc.1

Status: implemented

English | [中文](2026-08-21-desktop-sync-dsh-0.1.1-rc.1.zh.md)

## Problem

The Desktop fork must track the upstream `dsh-v0.1.1-rc.1` release without turning the independent DeepDive carrier into an upstream product variant or changing its Desktop version.

## Decision

This fork is adapted to the upstream `dsh-v0.1.1-rc.1` tag (upstream version `0.1.1-rc.1`). The synchronization was applied directly on the existing sync branch in ordered batches, with conflicts resolved at their owning files. Desktop keeps its independent `0.1.5` version and remains a carrier around the upstream Web profile.

## Scope

- Inherit the upstream release, Web/UI, session, authorization, documentation, and test updates that do not conflict with the Desktop carrier.
- Keep DeepDive branding, packaging rules, Tauri lifecycle, and the existing low-intrusion Desktop surface.
- Do not change Harness business behavior for Desktop-only reasons.

## Alternatives considered

- **One opaque rebase of the entire range** — rejected for this cycle because the change set contains unrelated documentation, CI, Web, session, and authorization work with different conflict and verification costs.
- **A separate temporary integration branch** — rejected because the existing synchronization branch is the maintained work surface; the batches were applied directly there.
- **Changing the Desktop version to the upstream version** — rejected because Desktop releases use an independent SemVer line.

## Consequences

The fork inherits the upstream `0.1.1-rc.1` source updates while keeping DeepDive branding, Desktop `0.1.5`, and the Tauri carrier boundary. The worktree remains uncommitted for maintainer review; Windows packaging remains a CI-only check on this macOS host.

## Verification

The synchronized tree has no unresolved merge entries. Windows packaging remains a CI responsibility; this macOS host does not attempt a Windows build.

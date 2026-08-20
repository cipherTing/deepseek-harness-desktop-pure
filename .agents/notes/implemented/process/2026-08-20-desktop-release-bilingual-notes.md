# Agent Note: Desktop releases take bilingual dispatch notes

Status: implemented

English | [中文](2026-08-20-desktop-release-bilingual-notes.zh.md)

## Problem

The generated GitHub Release body could reduce a Desktop release to a compare link, leaving users without a concise explanation of what changed in either Chinese or English.

## Decision

The manual Desktop workflow accepts separate Chinese and English Markdown inputs. Each input is a concise Markdown bullet list that summarizes high-level, user-facing changes without implementation details or investigation history. A run on any non-master ref remains a package-validation run and does not require either input. A master publication rejects blank input before the platform builds begin.

The release job writes both values through environment variables into one Markdown file under fixed Chinese and English headings, then passes that file to `gh release create --notes-file`. GitHub-generated notes are not appended.

## Alternatives considered

**Keep GitHub-generated notes.** Rejected because a compare link is not a meaningful bilingual release summary.

**Use one free-form release-notes input.** Rejected because the workflow could not guarantee that both languages were present or presented consistently.

**Commit release notes before every release.** Rejected because the maintainer needs to provide the exact release summary while dispatching the immutable build, without creating a documentation-only source revision.

## Consequences

Every published Desktop release has a visible Chinese and English change summary. The dispatcher must prepare both concise lists before starting a master release, while branch validation stays available without release prose.

# Agent Note: Desktop 发布使用双语手动日志

Status: implemented

[English](2026-08-20-desktop-release-bilingual-notes.md) | 中文

## Problem

GitHub 自动生成的 Release 正文可能只剩一个比较链接，用户看不到简明的中文或英文更新说明。

## Decision

Desktop 手动工作流接收独立的中文和英文 Markdown 输入。每份输入都是简洁的 Markdown 列表，只概括用户能感知的高层改动，不写实现细节或排查过程。任何非 `master` ref 的运行仍是安装包验证，不要求填写任一输入。`master` 发布会在双平台构建开始前拒绝空白输入。

发布任务通过环境变量将两个输入写进同一个 Markdown 文件，并使用固定的中文、英文标题，再把该文件传给 `gh release create --notes-file`。不会追加 GitHub 自动生成的日志。

## Alternatives considered

**继续使用 GitHub 自动生成的日志。** 不采用，因为比较链接不是有意义的双语发布摘要。

**使用一个自由格式的更新日志输入。** 不采用，因为工作流无法保证两种语言都存在，也无法稳定展示。

**每次发布前把更新日志提交进仓库。** 不采用，因为维护者需要在派发不可变构建时提供准确的发布说明，而不应为此单独创建文档提交。

## Consequences

每个发布的 Desktop Release 都会显示中文和英文更新说明。派发 `master` 发布前需要准备两份简洁列表，而分支验证仍可不填写发布文案。

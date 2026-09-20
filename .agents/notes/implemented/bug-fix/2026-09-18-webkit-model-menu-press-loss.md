# Agent Note: Restore model-menu row presses on WebKit

Status: implemented

English | [中文](2026-09-18-webkit-model-menu-press-loss.zh.md)

## Problem

In the `0.1.6-alpha.2` kernel the composer's model menu hands the keyboard to the row in use when a pane is drilled into. WebKit gives a pressed `<button>` no focus, so pressing another row moves focus off the focused one and reports no related target. The card's blur guard reads that as "focus left the card" and closes it during the press, which unmounts the row before its `click` — so no `session.selectModel` is sent and the model never changes. Every row is affected, and macOS WebKit is exactly the engine DeepDive Desktop ships on macOS; Chromium, which is Windows WebView2, focuses the pressed row and never reaches the guard. The upstream reports and their analysis are [deepseek-ai/deepseek-harness#6997](https://github.com/deepseek-ai/deepseek-harness/discussions/6997) and [#7002](https://github.com/deepseek-ai/deepseek-harness/discussions/7002).

## Decision

The portaled menu card cancels only the press's focus move, and only for presses that land on a button inside it: `onMouseDown` calls `preventDefault()` when the event target sits inside a `button`. The click still fires, the focused row keeps focus, and the card's blur guard and key handling stay exactly as they are. Presses on the card's own chrome, which has nothing to focus, keep the browser default. The shape follows the existing press guard in `ui-directory-picker-browse`, whose rows suppress the same focus steal.

## Verification

The component spec drives the gesture a real pointer makes: after drilling into the model pane, pressing a row is default-prevented, the row stays mounted, a press on the card's chrome is untouched, and the following click selects the model. It fails against the unfixed component and passes with it.

A throwaway Playwright scenario drove the shipped bundle through the real web scaffold in both engines, clicking the row with a real pointer and reading the trigger's label:

| engine | unfixed | fixed |
| --- | --- | --- |
| WebKit 26.5 (macOS WebView) | trigger stayed on the starting model | selects the pressed row |
| Chromium (Windows WebView2) | selects the pressed row | selects the pressed row |

The package's menu, portal, keyboard, catalog, and selection specs stay green, and repository lint and typecheck pass.

## Alternatives considered

- **Ignore a blur that carries no related target.** The card stays open, but focus has already fallen to the page body, where the card's key handling no longer sees a keystroke, so Escape and the arrow keys stop working until the trigger is clicked again. It also changes Chromium, where pressing the card's chrome currently closes the menu.

- **Drop the blur close entirely.** The menu already closes on an outside pointer press, on Escape, and after a selection, but the same Chromium behavior change applies and the WebKit failure is one cancelled focus move away from any other card that focuses its rows.

## Consequences

The model menu selects by mouse again on WebKit engines, including the macOS Desktop build, without changing Chromium behavior or the keyboard model added for drilled panes. This is a temporary fork-side patch: the handler carries a comment naming the upstream reports, and the synchronization that brings upstream's own fix adopts that fix and deletes the handler.

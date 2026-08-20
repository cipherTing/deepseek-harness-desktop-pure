# Agent Note: Desktop omits the native application menu

Status: implemented

English | [中文](2026-08-19-desktop-omits-native-menu.zh.md)

## Problem

Desktop installed a native application menu whose File, View, Edit, and Window actions duplicated system controls or WebView behavior. Windows rendered it as a permanent row below the title bar, while the macOS menu exposed actions that the Desktop product does not need.

## Decision

Desktop does not construct or install a native application menu on any platform. Closing a window still enters the shared `ExitRequested` path, which waits for the sidecar shutdown before exiting. macOS retains its overlay title bar and native traffic lights; Windows retains its normal system title bar.

## Alternatives considered

**Install an empty or hidden menu.** Rejected because the menu object itself is unnecessary and leaves behavior dependent on platform-specific Tauri and WebView details.

**Hide the row with Web CSS.** Rejected because the menu is native window chrome outside the WebView document.

**Keep a macOS-only application menu.** Rejected because its actions are unused in the Desktop product and do not justify a separate platform-specific control surface.

## Consequences

Both platforms present only native window controls and WebView content. Desktop no longer provides menu-backed reload or quit accelerators; title-bar close remains supported and preserves graceful sidecar cleanup. The source-level Desktop test fixes the complete absence of menu construction and installation, while platform builds remain responsible for native window behavior.

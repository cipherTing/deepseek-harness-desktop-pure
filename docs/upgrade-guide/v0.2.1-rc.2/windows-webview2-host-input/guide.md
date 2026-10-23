---
kind: upgrade-guide
description: "Windows Desktop requires WebView2 Runtime 138.0.3351.48 or newer for native shortcuts in embedded pages."
---

# Update the Windows WebView2 Runtime

English | [中文](guide.zh.md)

## Change

Windows Desktop now requires the Evergreen WebView2 Runtime version 138.0.3351.48 or newer. Older runtimes cannot route embedded-page keyboard input through the host, so DeepDive stops startup with an error instead of leaving Browser and HTML preview shortcuts incomplete.

## Migration

1. Install or update the Evergreen WebView2 Runtime from Microsoft's [WebView2 Runtime downloads](https://developer.microsoft.com/microsoft-edge/webview2/) page. The Desktop installer downloads a runtime only when none is installed.
2. Restart DeepDive. Confirm that it opens and that configured shortcuts work from both the Sidebar Browser and an HTML preview.

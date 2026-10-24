# Tao

Tao 0.35.3 with macOS diagnostic instrumentation in `src/platform_impl/macos/app.rs`. The `NSApplication::sendEvent:` callback catches panics raised in its Rust dispatch body and logs the dispatch stage. If the event has not been forwarded to AppKit, the callback forwards it after the panic. This instrumentation does not identify or fix the originating panic.

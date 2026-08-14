# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This repository is an independent desktop packaging fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It packages the upstream Web client as a Tauri desktop client for macOS Apple Silicon and Windows x64.

This is not the official DeepSeek Harness repository and is not a second Harness implementation. Tauri directly hosts the built Web assets, while a bundled Node.js sidecar runs the same Harness backend composition without starting the Harness WebServer or a localhost transport.

## What this repository does

- Packages the upstream Web client as a self-contained Desktop application.
- Carries Node.js and the compiled Harness dependency closure, so released packages do not require a user-installed Node.js or package manager.
- Connects the Web client to Harness through a Desktop IPC adapter instead of HTTP or WebSocket transport.
- Builds versioned macOS Apple Silicon and Windows x64 packages through maintainer-run local commands or the manual packaging workflow.
- Uses an independent Desktop version beginning at `0.1.0`; `desktop/package.json` is its source of truth and upstream revisions are recorded separately for release traceability.

## What it does not change

- It does not add Harness features or change non-Desktop Harness behavior.
- Desktop and native Web startup use the same Harness configuration files, environment rules, profiles, sessions, workspaces, caches, and user directories.
- Existing Harness paths are not redirected to the Tauri installation directory, bundle resources, or Tauri application-data directories.
- The repository's `desktop/` directory contains packaging source and resources; it is not a separate Harness workspace or user-data directory.
- Upstream synchronization and GitHub Releases are manual maintainer actions. The packaging workflow is manual-only and does not select or synchronize upstream commits or create Releases.

## Run

Use the [upstream Web run instructions](https://github.com/deepseek-ai/deepseek-harness#run) to start the native Web client.

### Run from source

Use the [upstream source run instructions](https://github.com/deepseek-ai/deepseek-harness#run-from-source) for checkout development.

### Run Desktop development

After installing the repository's contributor dependencies, start Tauri and its bundled Harness sidecar from the repository root:

```sh
pnpm desktop:dev
```

### Build a Desktop package

Run the build on a supported target machine:

```sh
pnpm desktop:build
```

The command builds macOS Apple Silicon on an Apple Silicon Mac or Windows x64 on a Windows x64 machine, then writes the versioned package to `desktop/dist/` as `deepseek-harness-desktop-macos-arm64-<version>.dmg` or `deepseek-harness-desktop-windows-x64-<version>.exe`.

Releases are created manually. Record the Desktop version, synchronized upstream commit and tag when present, and fork commit in the GitHub Release description. The packaging workflow only uploads build artifacts; it does not create a Release. The current synchronized upstream commit is stored in [`desktop/UPSTREAM_COMMIT`](desktop/UPSTREAM_COMMIT).

## Upstream project

Use the [upstream DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) for the Harness architecture, Web behavior, plugin model, source development guide, and project contribution process. This fork keeps its Desktop-specific rules in [AGENTS.md](AGENTS.md).

## License

This fork retains the [MIT License](LICENSE) and the upstream project attribution. Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

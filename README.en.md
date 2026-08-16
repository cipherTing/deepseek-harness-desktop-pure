<p align="center">
  <img src="desktop/assets/deepseek.png" width="112" height="112" alt="DeepSeek Harness Desktop">
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center"><strong>A clean, ready-to-use desktop distribution of the upstream DeepSeek Harness Web client.</strong></p>

<p align="center"><a href="README.md">简体中文</a> · English</p>

<p align="center">
  <a href="https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/latest"><img src="https://img.shields.io/github/v/release/cipherTing/deepseek-harness-desktop-pure?display_name=tag&sort=semver&label=release" alt="Latest release"></a>
  <a href="https://github.com/cipherTing/deepseek-harness-desktop-pure/actions/workflows/build-desktop.yml"><img src="https://github.com/cipherTing/deepseek-harness-desktop-pure/actions/workflows/build-desktop.yml/badge.svg" alt="Desktop build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/cipherTing/deepseek-harness" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%7C%20Windows%20x64-2f6feb" alt="Supported platforms">
</p>

<p align="center">
  <a href="https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/latest"><strong>Download the latest release</strong></a>
  · <a href="https://github.com/deepseek-ai/deepseek-harness">Upstream project</a>
  · <a href="https://github.com/cipherTing/deepseek-harness-desktop-pure/issues">Desktop issues</a>
</p>

> **Project boundary: this project does exactly one thing, package the original DeepSeek Harness Web client as a clean Desktop distribution.** It does not add Harness features, change business logic, maintain a second configuration or data model, or turn the upstream project into a separate "Desktop mode."

## Project scope

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is the only source of Harness product functionality. This repository is an independent desktop-distribution fork responsible only for the Tauri shell, bundled runtime, required Desktop system adapters, and macOS/Windows packages.

| Principle | Meaning |
| --- | --- |
| **Clean packaging** | Preserve the upstream Web UI, APIs, event streams, dynamic plugins, and Harness runtime semantics instead of copying or rewriting Web functionality. |
| **No runtime setup** | Release packages include Node.js and the Harness production dependency closure; users do not install Node.js, pnpm, Rust, or another development environment. |
| **One data model** | Desktop and native Web use the same `DSH_HOME`, `~/.dsh`, `.env` loading rules, settings, credentials, sessions, workspaces, and caches. |
| **Extremely low intrusion** | Desktop integration stays under `desktop/` whenever possible; upstream code changes are allowed only for a concrete Tauri blocker and must remain minimal. |
| **Independent distribution** | Desktop has its own SemVer releases, while the synchronized upstream revision is recorded separately. |

## Download and install

Download the latest package for your platform from [GitHub Releases](https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/latest). Once installed, launch the application directly; no Node.js or package-manager setup is required.

| Platform | Package | Support |
| --- | --- | --- |
| macOS | `deepseek-harness-desktop-macos-arm64-<version>.dmg` | macOS 11 or newer, Apple Silicon only. |
| Windows | `deepseek-harness-desktop-windows-x64-<version>.exe` | Windows x64 using the system Evergreen WebView2 Runtime; the installer downloads it only when missing. |

> **Installation note:** Current macOS packages use ad-hoc signing and are not Apple-notarized. Windows packages do not use a purchased commercial code-signing certificate. The operating system may therefore show a developer or SmartScreen warning on first install; confirm that the package came from this repository's GitHub Release.

## Runtime architecture

Desktop does not rewrite the Harness backend in Rust or reimplement browser transport. Tauri starts the bundled Node.js sidecar, which boots the standard `web` profile on a random `127.0.0.1` port. The system WebView loads that address directly. The listener is bound only to the local loopback interface and is not exposed to the LAN or public network.

```mermaid
flowchart LR
  U["User"] --> W["Tauri WebView"]
  T["Tauri native shell"] -->|"start, supervise, stop"| S["Bundled Node.js sidecar"]
  W -->|"loopback HTTP / WebSocket"| S
  T <-->|"native directory and path operations"| S
  S --> H["Upstream Harness web profile"]
  H --> D["DSH_HOME / ~/.dsh"]
```

The upstream Web Host remains responsible for the index document, client-plugin bundles, `/api`, event streams, and dynamic-plugin updates. Desktop owns only the native window, process lifecycle, distribution, and required operating-system interactions.

## Configuration and data compatibility

- An existing `DSH_HOME` is inherited unchanged; otherwise Harness continues to resolve it as `~/.dsh`.
- `.env` files follow the existing Harness loading order; Desktop does not introduce a separate environment file.
- The sidecar starts with the operating-system user home as its working directory, never the Tauri install, resource, or application-data directory.
- Desktop and native Web can read the same settings, credentials, profiles, sessions, workspaces, and caches.
- Bundled Node.js, JavaScript dependencies, and Tauri resources are runtime files only and are never mixed with Harness user data.

## Native Web and upstream source

### Run

To start the native Web client directly, follow the [upstream run instructions](https://github.com/deepseek-ai/deepseek-harness#run). Desktop neither replaces nor changes that path.

### Run from source

To develop Harness itself or launch from upstream source, follow the [upstream source instructions](https://github.com/deepseek-ai/deepseek-harness#run-from-source). This repository adds only the Desktop packaging layer on top.

## Local development

The repository keeps the upstream development workflow and adds two root-level Desktop commands. Desktop CI and release packaging pin Node.js `22.23.2`, pnpm `11.7.0`, Rust `1.96.0`, and Tauri 2.

Install dependencies:

```sh
pnpm install
```

Start Desktop development:

```sh
pnpm desktop:dev
```

Build a package for the current platform:

```sh
pnpm desktop:build
```

The macOS package must be built on an Apple Silicon Mac, and the Windows x64 package must be built in a Windows x64 environment. See [AGENTS.md](AGENTS.md) for maintenance rules, incremental development commands, and release constraints.

## Versioning and releases

- [`desktop/package.json`](desktop/package.json) is the only Desktop version source.
- Change the version with `pnpm desktop:version:set -- <version>`, then verify all mirrors with `pnpm desktop:version:check`.
- [`desktop/UPSTREAM_COMMIT`](desktop/UPSTREAM_COMMIT) records only the latest upstream commit incorporated into this fork, never the fork HEAD.
- GitHub Actions is maintainer-triggered only; a `v<version>` Release is published after both macOS and Windows builds succeed.
- CI never fetches, merges, or rebases upstream automatically. Upstream synchronization is reviewed and performed manually.

## Where to report an issue

| Issue | Destination |
| --- | --- |
| Desktop installation, startup, packaging, signing, native dialogs, window behavior, or sidecar lifecycle | [This repository's Issues](https://github.com/cipherTing/deepseek-harness-desktop-pure/issues) |
| Harness features, model providers, Agent behavior, plugin mechanics, or Web product functionality | [Upstream DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/issues) |

This repository does not accept new Harness features unrelated to Desktop packaging. If a capability should also exist in the CLI, native Web, or another Harness runtime, it belongs upstream rather than in a Desktop-private implementation here.

## Contributing

Contributions that fix Desktop packaging, platform compatibility, Tauri integration, or the release pipeline are welcome. Read [AGENTS.md](AGENTS.md) first and keep every change minimal, complete, low-intrusion, and behavior-preserving.

Maintainer: [cipherTing](https://github.com/cipherTing)

## License and attribution

This fork retains the upstream [MIT License](LICENSE). Third-party dependencies and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). DeepSeek names and marks remain the property of their respective owners and are used only to identify the upstream project packaged here; see [desktop/assets/README.md](desktop/assets/README.md) for the icon source and license.

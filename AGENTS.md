# DeepSeek Harness Desktop Fork

This independent distribution fork packages [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with Tauri. It is not upstream, a second Harness implementation, or a place for new Harness features.

A bundled Node.js sidecar starts the standard `web` profile on a random loopback port (`--host 127.0.0.1 --port 0`), and the WebView loads it directly. The upstream web host remains the source of the index, boot manifest, plugin bundles, `/api`, and event streams. Desktop adds no custom URI scheme, boot snapshot, or HTTP reimplementation; framed IPC carries only readiness, `graph-changed`, native dialogs/path opening, and shutdown.

## Fork scope

- Do not add Harness features, change Harness behavior, or refactor unrelated upstream code.
- Keep the smallest complete, extremely low-intrusion solution inside `desktop/`. A change elsewhere requires a concrete integration blocker and must be minimal; speculative abstractions, broad transport refactors, and Desktop-motivated cleanup are prohibited.
- Use official Tauri plugins and APIs for system interaction when an official capability exists. Do not replace an official plugin with an ad hoc native bridge.
- Releases are self-contained: users install no Node.js, pnpm, runtime, or package manager. Support only macOS Apple Silicon and Windows x64 unless explicitly changed.
- `desktop/` contains packaging source and resources, never a Harness profile, workspace, configuration home, or user-data directory.

## Upstream synchronization

Synchronization is manual. Do not automate selecting, validating, fetching, merging, rebasing, or recording upstream revisions. The maintainer fetches commits and tags, normally integrates a tagged commit (or latest commit when no tag exists), resolves Desktop conflicts deliberately, and verifies the fork.

After verification, replace the sole full SHA in [`desktop/UPSTREAM_COMMIT`](desktop/UPSTREAM_COMMIT). Never append history, record fork HEAD, or let tooling infer or rewrite it. Mirror an upstream tag into the fork when the synchronized commit has one, preserving its target.

## Desktop version and releases

- Desktop uses independent SemVer beginning at `0.1.0`; upstream tags and SHAs never determine versions or artifact names. `desktop/package.json` is the sole version source. Run `pnpm desktop:version:set -- <version>` to update its runtime manifest, `Cargo.toml`, and Desktop `Cargo.lock` entry, or `pnpm desktop:version:check` to verify them. Never change the upstream root version for a Desktop release.
- From the repository root, use `pnpm desktop:dev` or `pnpm desktop:build`. Package names derive from the Desktop version.
- `.github/workflows/build-desktop.yml` runs only by `workflow_dispatch`. Any fork ref may run the two-platform build for validation; only `master` may publish a Release. It freezes the dispatched commit SHA for both platforms and any release tag, never synchronizes upstream, and never changes versions.
- Only `Build and release Desktop` may remain enabled in this fork. Keep upstream workflow files unchanged but disabled in GitHub Actions. After synchronization, disable newly introduced upstream workflows; do not enable upstream CI, docs, E2E, issue automation, or releases without explicit maintainer approval.
- Artifacts are named `deepseek-harness-desktop-macos-arm64-<version>.dmg` and `deepseek-harness-desktop-windows-x64-<version>.exe`.
- After both builds pass, publish immutable tag/title `v<version>` with GitHub-generated notes only. Bump the version instead of replacing an existing tag or release. Upstream traceability comes from tagged fork source plus `desktop/UPSTREAM_COMMIT`, not duplicated release prose.
- Windows packaging uses the system Evergreen WebView2 Runtime with Tauri's `downloadBootstrapper` fallback. Do not bundle the offline WebView2 installer.

## Runtime and path invariants

Desktop adds a carrier, not a Harness mode. Native Web and Desktop share configuration, environment layering, `DSH_HOME`, profiles, sessions, workspaces, caches, and user directories. Do not redirect Harness paths to Tauri install/resource/app-data locations, set a Desktop-only `DSH_HOME`, or alter `.env` lookup. With no invoking terminal directory, the sidecar explicitly starts in the OS user home, matching a native launch there. Keep Tauri temporary files separate from Harness data.

Bundled Node.js, compiled Harness code, and dependencies are application resources, never the Harness working directory, configuration home, or user data.

## Tauri integration

Tauri owns the window, assets, sidecar lifecycle, readiness, framed IPC, native dialogs/open operations, and distribution. Expose only business-level Desktop commands; never grant the WebView generic shell or filesystem access.

The sidecar runs upstream `web` plus a read-only overlay that replaces directory picking, applies Desktop open-path defaults through the shared API-proxy trust fence, and adds bridge/index/prompt/info glue and Desktop client UI. Standard Web transport and user patches remain active; `graph-changed` reloads the page. The bundled runtime contains Node.js, compiled packages, and production dependencies. It must stop with Tauri without unmanaged descendants.

Unexpected exits get at most three backoff respawns; update the live origin before navigating the window. Final startup/respawn failure shows a modal error and preserves a nonzero exit code. View > Reload Page uses `CmdOrCtrl+R`, and the default WebView context menu remains available. macOS uses Tauri's overlay title bar with native traffic lights; the top strip preserves native-style drag and double-click zoom through Tauri window APIs, while Windows keeps its native title bar. Rust downloads session exports directly from the current loopback host with a total timeout; framed IPC remains limited to readiness, `graph-changed`, system requests, and shutdown.

### Sanctioned upstream surface change

The sanctioned non-`desktop/` changes are the single root `settings.update` seat beside `settings.trigger`, declared by `packages/client/ui-settings`, rendered by `packages/client/ui-settings-general`/`SettingsRoot`, occupied only by the Desktop update badge, and empty on Web; and the generic asynchronous save carrier in `packages/session-query/session-log-export`, whose default browser carrier remains unchanged and which Desktop may install for native Session ZIP saving. About Desktop uses the existing `settings.section` list at the last navigation position.

### Development loop

- Cold start: `pnpm desktop:dev` (full Harness/runtime/deploy/Node preparation).
- Runtime/bridge/client-UI: `pnpm --filter @deepseek-ai/dsh-desktop run build:runtime`, then restart `tauri dev`.
- Harness package iteration: `pnpm run build:harness`, then the runtime iteration step.
- Shell-only iteration: `DESKTOP_SKIP_BUNDLE=1 pnpm desktop:dev` (cargo rebuild only).
- CI prepares once, runs Node and Rust tests, then lets tauri-action reuse the artifacts with `DESKTOP_SKIP_BUNDLE=1`.

---

# Original AGENTS.md

# AGENTS.md

DeepSeek Harness is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-release stance: foundation over blast radius

**Remove this section at the first tagged release.** With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

```
vendor/      Vendored Cordis source — manifest + sync procedure in vendor/README.md
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  shell/        bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider
  terminal/         persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/     compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable dsh --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential-reference capability + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared app-bin glue
  sdk/         JSON-RPC protocol, server, and TypeScript client
  examples/    demo bundles (agent-spine + CLI/ACP/JSON-RPC bins)
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @deepseek-ai/node-addon-landlock-run source of record (see native/README.md)
examples/    Runnable cordis.yml leaves over packages/examples bundles (see examples/AGENTS.md)
.agents/     Agent workflows and Agent Notes (`notes/`)
docs/        architecture, generated catalogs, postmortems, cookbook (see docs/AGENTS.md)
scripts/     repo gates and generators
website/     VitePress projection of selected bilingual docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run test           # vitest unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:snapshot  # keyless ACP/headless replay vs expected outputs; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:cordis    # the agent modifies its own runtime (needs key)
pnpm run demo:acp       # ACP automation server (needs DEEPSEEK_API_KEY)
```

### Host sandbox failures

When required `gh`, `pnpm`, build, test, or generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation before diagnosing authentication or project failure. Require sandbox evidence; never bypass genuine test failures or the product sandbox under test.

### Run relevant checks locally

Run checks before pushes via [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass.

- Match evidence to the surface: focused tests for behavior, snapshots for model or user output, `doc-sync` for docs, build/hygiene and built smokes for published paths, and real-API e2e for provider behavior.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)).

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service or method presence, plugin metadata or effects, or fixed pure examples. Without a plausible relationship, an explained empty companion is correct ([package invariant rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. A `SessionEventMap` member is required-on-read by default — builds that do not know its type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** Each package uses one aggregate except `api/remotes`; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- Do not comment on facts obvious from code.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible behavior change adds or updates a keyless snapshot through a real runnable example in the same PR; package tests, e2e-only assertions, and mock-only fixtures do not substitute for the assembled application transcript. Fixtures must replay on macOS/Linux; fix fixtures, not normalizers.
- **A tool's UI render intent is part of its design**, decided up front (`generic`/`terminal`/`diff`, `locations`); presentation methods are pure functions of `args` ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Choose PR history deliberately.** Split independent changes; fix the introducing PR before propagation. Standalone PRs and official stacks may merge-forward or rebase after review. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; an in-progress merge-forward preserves its checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts together. Routine bilingual work follows [docs/AGENTS.md](docs/AGENTS.md); only explicit user invocation may run `dsh-translate-docs`. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live there.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root, `packages/`, and `examples/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run test && pnpm run build`.

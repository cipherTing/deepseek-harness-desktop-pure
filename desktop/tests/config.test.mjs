import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'))

test('Desktop version and root shortcuts use the Desktop package', () => {
  const rootPackage = readJson(new URL('../../package.json', import.meta.url))
  const desktopPackage = readJson(new URL('../package.json', import.meta.url))
  const runtimePackage = readJson(new URL('../runtime/package.json', import.meta.url))
  const tauriConfig = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))
  const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const cargoLock = readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8')

  assert.match(desktopPackage.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  assert.equal(runtimePackage.version, desktopPackage.version)
  assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], desktopPackage.version)
  assert.equal(cargoLock.match(/\[\[package\]\]\nname = "deepseek-harness-desktop"\nversion = "([^"]+)"/m)?.[1], desktopPackage.version)
  assert.equal(tauriConfig.version, '../package.json')
  assert.equal(rootPackage.scripts['desktop:dev'], 'pnpm --filter @deepseek-ai/dsh-desktop run dev')
  assert.equal(rootPackage.scripts['desktop:build'], 'pnpm --filter @deepseek-ai/dsh-desktop run build')
  assert.equal(rootPackage.scripts['desktop:version:check'], 'pnpm --filter @deepseek-ai/dsh-desktop run version:check')
  assert.equal(rootPackage.scripts['desktop:version:set'], 'pnpm --filter @deepseek-ai/dsh-desktop run version:set')
})

test('Desktop workflow builds any manual ref and releases only one frozen master SHA', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/build-desktop.yml', import.meta.url), 'utf8')

  assert.match(workflow, /on:\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*(push|pull_request):/m)
  assert.doesNotMatch(workflow, /inputs:\n\s+ref:/)
  assert.match(workflow, /group: desktop-release/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /Desktop releases must be dispatched from master/)
  assert.match(workflow, /source_sha: \$\{\{ steps\.release\.outputs\.source_sha \}\}/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /ref: \$\{\{ needs\.metadata\.outputs\.source_sha \}\}/)
  assert.match(workflow, /Release tag \$tag already exists/)
  assert.match(workflow, /if \[\[ "\$GITHUB_REF" == "refs\/heads\/master" \]\]/)
  assert.match(workflow, /uses: tauri-apps\/tauri-action@v1/)
  assert.match(workflow, /uploadWorkflowArtifacts: true/)
  assert.match(workflow, /releaseAssetNamePattern: deepseek-harness-desktop-\$\{\{ matrix\.platform \}\}-\[version\]\[ext\]/)
  assert.match(workflow, /platform: macos-arm64/)
  assert.match(workflow, /platform: windows-x64/)
  assert.match(workflow, /uses: actions\/download-artifact@[0-9a-f]{40} # v8/)
  assert.match(workflow, /merge-multiple: true/)
  assert.match(workflow, /Expected exactly one DMG and one EXE artifact/)
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/master'/)
  assert.match(workflow, /gh release create "\$RELEASE_TAG"/)
  assert.match(workflow, /--target "\$SOURCE_SHA"/)
  assert.match(workflow, /--title "\$RELEASE_TAG"/)
  assert.match(workflow, /--generate-notes/)
  assert.match(workflow, /--fail-on-no-commits/)
  assert.doesNotMatch(workflow, /(?:^|\s)--notes(?:\s|=)/m)
})

test('Tauri prepares the bundle exactly once', () => {
  const desktopPackage = readJson(new URL('../package.json', import.meta.url))
  const tauriConfig = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))

  assert.equal(desktopPackage.scripts.dev, 'tauri dev')
  assert.equal(desktopPackage.scripts.build, 'tauri build')
  assert.equal(existsSync(new URL('../scripts/build-desktop.mjs', import.meta.url)), false)
  assert.match(desktopPackage.scripts['build:runtime'], /pnpm run deploy:runtime/)
  assert.deepEqual(tauriConfig.build.beforeDevCommand, {
    script: 'pnpm run bundle:prepare',
    wait: true,
  })
  assert.equal(tauriConfig.build.beforeBuildCommand, 'pnpm run bundle:prepare')
})

test('macOS overlays the native title bar with drag and double-click zoom gestures', () => {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../bridge/src/index.ts', import.meta.url), 'utf8')
  const capability = readJson(new URL('../src-tauri/capabilities/main.json', import.meta.url))

  assert.match(rust, /#\[cfg\(target_os = "macos"\)\]/)
  assert.match(rust, /TitleBarStyle::Overlay/)
  assert.match(rust, /hidden_title\(true\)/)
  assert.match(rust, /decorations\(true\)/)
  assert.doesNotMatch(rust, /decorations\(false\)/)
  assert.match(bridge, /getCurrentWindow/)
  assert.match(bridge, /MACOS_TITLE_BAR_HEIGHT/)
  assert.match(bridge, /startDragging\(\)/)
  assert.match(bridge, /toggleMaximize\(\)/)
  assert.ok(capability.permissions.includes('core:window:allow-start-dragging'))
  assert.ok(capability.permissions.includes('core:window:allow-toggle-maximize'))
  assert.doesNotMatch(rust, /\.devtools\(false\)/)
  assert.doesNotMatch(rust, /initialization_script\(DISABLE_CONTEXT_MENU_SCRIPT\)/)
  assert.doesNotMatch(rust, /addEventListener\("contextmenu"/)
})

test('Desktop loads the loopback web host without custom protocols', () => {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const buildScript = readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8')
  const tauriConfig = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))
  const capability = readJson(new URL('../src-tauri/capabilities/main.json', import.meta.url))
  const entitlements = readFileSync(new URL('../src-tauri/node-entitlements.plist', import.meta.url), 'utf8')
  const runtimePackage = readJson(new URL('../runtime/package.json', import.meta.url))
  const overlay = readFileSync(new URL('../runtime/overlay.yml', import.meta.url), 'utf8')

  // No custom URI schemes, no boot snapshot, no plugin allowlist.
  assert.doesNotMatch(rust, /register_uri_scheme_protocol/)
  assert.doesNotMatch(rust, /plugin\.read/)
  assert.doesNotMatch(rust, /index_html|indexHtml/)
  // The window loads the sidecar's loopback HTTP origin and reloads on graph
  // changes; navigation is pinned to that origin.
  assert.match(rust, /WebviewUrl::External/)
  assert.match(rust, /graph-changed/)
  assert.match(rust, /on_navigation/)
  // The bundled frontend dist is served by the harness itself.
  assert.equal(tauriConfig.build.frontendDist, 'resources/shell')
  assert.deepEqual(tauriConfig.bundle.resources, ['rt/**/*'])
  assert.equal(existsSync(new URL('../src-tauri/resources/web', import.meta.url)), false)
  // Remote IPC is granted only to the loopback web host.
  assert.deepEqual(capability.remote, { urls: ['http://127.0.0.1:*'] })
  // Tauri blocks undeclared application commands from remote origins. The
  // loopback page receives only these business-level Desktop operations.
  for (const command of [
    'allow-desktop-open-external-url',
    'allow-desktop-open-file',
    'allow-desktop-file-handlers',
    'allow-desktop-open-file-with',
    'allow-desktop-copy-text',
    'allow-desktop-reveal-file',
    'allow-desktop-save-file-as',
    'allow-desktop-copy-file-contents',
    'allow-desktop-save-session',
  ]) {
    assert.ok(capability.permissions.includes(command))
  }
  // Custom commands are rejected from a remote origin unless Tauri generates
  // matching application-manifest permissions in build.rs.
  assert.match(buildScript, /tauri_build::try_build/)
  assert.match(buildScript, /AppManifest::new\(\)\.commands/)
  for (const command of [
    'desktop_open_external_url',
    'desktop_open_file',
    'desktop_file_handlers',
    'desktop_open_file_with',
    'desktop_copy_text',
    'desktop_reveal_file',
    'desktop_save_file_as',
    'desktop_copy_file_contents',
    'desktop_save_session',
  ]) {
    assert.match(buildScript, new RegExp(`"${command}"`))
  }
  // macOS hardened runtime needs outbound network access for the WebView.
  assert.match(entitlements, /<key>com\.apple\.security\.network\.client<\/key>\s*<true\/>/)
  // The in-process fake HTTP server is gone; the desktop API gateway keeps
  // the shared apiproxy core and only swaps the open-path defaults.
  assert.equal(runtimePackage.exports['./webserver'], undefined)
  assert.equal(runtimePackage.exports['./api-gateway'], './lib/api-gateway.mjs')
  // The overlay keeps the standard web transport rows enabled.
  assert.doesNotMatch(overlay, /- id: webserver\n\s+disabled: true/)
  assert.doesNotMatch(overlay, /- id: web-startup\n\s+disabled: true/)
  assert.doesNotMatch(overlay, /desktop-webserver/)
  assert.match(overlay, /desktop-api-gateway/)
  // One surface prompt: the desktop wording replaces the web one.
  assert.match(overlay, /surfaceContext: false/)
})

test('Desktop resolves native file handlers without giving the WebView executable access', () => {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const handlers = readFileSync(new URL('../src-tauri/src/file_handlers.rs', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../bridge/src/index.ts', import.meta.url), 'utf8')

  assert.match(rust, /fn desktop_file_handlers/)
  assert.match(rust, /fn desktop_open_file_with/)
  assert.match(rust, /file_handlers::find_for/)
  assert.match(handlers, /URLsForApplicationsToOpenURL/)
  assert.match(handlers, /URLForApplicationToOpenURL/)
  assert.match(handlers, /URLForApplicationWithBundleIdentifier/)
  assert.match(handlers, /RegGetValueW/)
  assert.match(handlers, /App Paths/)
  assert.match(handlers, /WINDOWS_DEVELOPER_APPLICATIONS/)
  assert.match(bridge, /desktop_file_handlers/)
  assert.match(bridge, /desktop_open_file_with/)
  assert.match(bridge, /desktop_copy_text/)
  assert.doesNotMatch(bridge, /document\.execCommand/)
  assert.match(bridge, /openWith/)
  assert.match(bridge, /defaultApplication/)
  assert.match(bridge, /max-height:min\(440px,calc\(100vh - 16px\)\)/)
  assert.match(bridge, /overflow-y:auto/)
  assert.match(bridge, /submenu\.style\.top/)
  assert.match(bridge, /width:calc\(100% \+ 8px\)/)
  assert.match(bridge, /width:calc\(100% - 8px\)/)
  assert.match(bridge, /dsh-desktop-link-submenu-panel/)
})

test('Windows release packaging avoids a console and Node main-script resolution', () => {
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')

  assert.match(main, /target_os = "windows"/)
  assert.match(main, /not\(debug_assertions\)/)
  assert.match(main, /windows_subsystem = "windows"/)
  assert.match(rust, /node_sidecar_import/)
  assert.match(rust, /--input-type=module/)
  assert.match(rust, /--eval/)
  assert.match(rust, /Url::from_file_path/)
})

test('Desktop uses the generic async save carrier instead of patching anchor clicks', () => {
  const bridge = readFileSync(new URL('../bridge/src/index.ts', import.meta.url), 'utf8')

  assert.match(bridge, /__DSH_DOWNLOAD_CARRIER__/)
  assert.match(bridge, /desktop_save_session/)
  assert.doesNotMatch(bridge, /HTMLAnchorElement\.prototype\.click/)
})

test('Desktop shell supervises its sidecar and exposes a reload affordance', () => {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const process = readFileSync(new URL('../src-tauri/src/sidecar_process.rs', import.meta.url), 'utf8')

  // Native menu with the CmdOrCtrl+R reload item (WKWebView has no built-in
  // browser accelerator; the default right-click menu remains available).
  assert.match(rust, /set_menu/)
  assert.match(rust, /on_menu_event/)
  assert.match(rust, /CmdOrCtrl\+R/)
  assert.match(rust, /CmdOrCtrl\+Q/)
  assert.match(rust, /begin_graceful_exit/)
  assert.doesNotMatch(rust, /PredefinedMenuItem::quit/)
  assert.match(rust, /\.reload\(\)/)
  // Startup failures preserve the exit code instead of masking it as 0.
  assert.match(rust, /code\.unwrap_or\(0\)/)
  assert.match(rust, /app\.exit\(exit_code\)/)
  // Unexpected exits are supervised: bounded respawn + user-visible failure.
  assert.match(rust, /supervise_sidecar/)
  assert.match(rust, /RESPAWN_ATTEMPTS/)
  assert.match(rust, /show_error_and_exit/)
  assert.match(rust, /blocking_show\(\)/)
  // The session export streams directly from the loopback host in Rust.
  assert.match(rust, /ureq::AgentBuilder/)
  assert.match(rust, /redirects\(0\)/)
  assert.match(rust, /download_export/)
  // Normal menu/Cmd+Q exit waits for the current generation to terminate.
  assert.match(rust, /wait_terminated/)
  // Dead protocol carriers are gone; the page abort is acknowledged.
  assert.doesNotMatch(rust, /desktop_stream_close/)
  assert.doesNotMatch(rust, /INITIAL_STREAM_CREDIT/)
  assert.match(rust, /"system-cancel"/)
  // The sidecar owns its full process scope through the Tauri-maintainer
  // recommended process-wrap crate, rather than a direct-child shell kill.
  const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  assert.match(cargo, /process-wrap = \{ version = "=9\.1\.0"/)
  assert.doesNotMatch(cargo, /tauri-plugin-shell/)
  assert.match(process, /ProcessGroup::leader\(\)/)
  assert.match(process, /JobObject/)
  assert.match(process, /CreationFlags\(CREATE_NO_WINDOW\)/)
  assert.match(process, /KillOnDrop/)
  assert.match(process, /child\.kill\(\)/)
  assert.match(process, /bundled_binary_path/)
  assert.doesNotMatch(cargo, /windows-sys/)
})

test('Desktop overlay rows match the shipped web composition contract', () => {
  const overlay = readFileSync(new URL('../runtime/overlay.yml', import.meta.url), 'utf8')
  const webPatch = readFileSync(
    new URL('../../packages/bundle/web-app/cordis.patch.yml', import.meta.url), 'utf8')

  // Rows the overlay disables must exist by those exact ids in the web layer.
  for (const id of ['directory-picker', 'api-gateway']) {
    assert.match(webPatch, new RegExp(`- id: ${id}\\b`), `web patch must define row ${id}`)
  }
  // The web surface disables the `hmr` row and keeps `client-hmr` mounted;
  // the desktop overlay must follow the same contract.
  assert.match(webPatch, /- id: hmr\n\s+disabled: true/)
  assert.doesNotMatch(overlay, /- id: client-hmr\n\s+disabled: true/)
  assert.match(webPatch, /- id: client-hmr\n\s+name: '@deepseek-ai\/dsh-client-hmr'/)
  // The desktop-only client UI (About section + update badge) is mounted.
  assert.match(overlay, /desktop-client-ui/)
})

test('Desktop client UI package ships the dsh.client contract', () => {
  const clientUi = readJson(new URL('../client-ui/package.json', import.meta.url))
  const runtime = readJson(new URL('../runtime/package.json', import.meta.url))

  assert.equal(clientUi.dsh.client.platform, 'web')
  assert.equal(clientUi.exports['./client'].default, './lib/client.js')
  assert.ok(clientUi.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(Object.keys(runtime.dependencies ?? {}).includes('@deepseek-ai/dsh-desktop-client-ui'))
  // Identity facts the About section surfaces.
  assert.equal(runtime.repository?.url, 'https://github.com/cipherTing/deepseek-harness-desktop-pure')
  assert.equal(typeof runtime.author, 'string')
})

test('Settings update seat is declared beside the settings trigger', () => {
  // The one sanctioned upstream surface change: the update badge seat right
  // of the settings trigger, declared by the settings shell.
  const contract = readFileSync(
    new URL('../../packages/client/ui-settings/src/client/contract/slots.ts', import.meta.url), 'utf8')
  const settingsGeneral = readFileSync(
    new URL('../../packages/client/ui-settings-general/src/client/index.ts', import.meta.url), 'utf8')

  assert.match(contract, /'settings\.update': \{ kind: 'single'; scope: 'root'/)
  assert.match(settingsGeneral, /'settings\.update': \{ kind: 'single', scope: 'root' \}/)
})

test('Windows uses downloadBootstrapper without an offline installer', () => {
  const config = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))
  assert.equal(config.bundle.windows.webviewInstallMode.type, 'downloadBootstrapper')
  assert.doesNotMatch(JSON.stringify(config), /offlineInstaller/)
})

test('Desktop bundles only the three required app icons', () => {
  const config = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))
  assert.deepEqual(config.bundle.icon, [
    '../assets/deepseek.png',
    '../assets/deepseek.icns',
    '../assets/deepseek.ico',
  ])
  assert.equal(existsSync(new URL('../src-tauri/icons', import.meta.url)), false)
})

test('macOS preserves the Node sidecar JIT and native addon permissions', () => {
  const config = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))
  const entitlements = readFileSync(new URL('../src-tauri/node-entitlements.plist', import.meta.url), 'utf8')

  assert.equal(config.bundle.macOS.entitlements, 'node-entitlements.plist')
  assert.deepEqual(config.bundle.externalBin, ['binaries/node'])
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/)
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/)
})

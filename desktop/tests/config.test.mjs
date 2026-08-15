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

test('Desktop release workflow is manual-only and publishes versioned packages from one master SHA', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/build-desktop.yml', import.meta.url), 'utf8')

  assert.match(workflow, /on:\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*(push|pull_request):/m)
  assert.doesNotMatch(workflow, /inputs:\n\s+ref:/)
  assert.match(workflow, /group: desktop-release/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /Desktop releases must be dispatched from master/)
  assert.match(workflow, /source_sha: \$\{\{ steps\.release\.outputs\.source_sha \}\}/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /ref: \$\{\{ needs\.metadata\.outputs\.source_sha \}\}/)
  assert.match(workflow, /Release tag \$tag already exists/)
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

test('Desktop uses native title bars and suppresses the default WebView context menu', () => {
  const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')

  assert.doesNotMatch(rust, /TitleBarStyle::Overlay|hidden_title\(true\)/)
  assert.doesNotMatch(rust, /\.devtools\(false\)/)
  assert.match(rust, /initialization_script\(DISABLE_CONTEXT_MENU_SCRIPT\)/)
  assert.match(rust, /window\.location\.protocol === "dsh-app:"/)
  assert.match(rust, /window\.location\.hostname === "dsh-app\.localhost"/)
  assert.match(rust, /addEventListener\("contextmenu"/)
  assert.match(rust, /event\.preventDefault\(\)/)
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

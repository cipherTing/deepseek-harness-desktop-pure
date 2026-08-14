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

test('Desktop packaging workflow is manual-only and uploads versioned packages', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/build-desktop.yml', import.meta.url), 'utf8')

  assert.match(workflow, /on:\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*(push|pull_request):/m)
  assert.match(workflow, /pnpm desktop:build/)
  assert.match(workflow, /deepseek-harness-desktop-\$\{\{ matrix\.platform \}\}-\$\{\{ steps\.desktop-version\.outputs\.version \}\}/)
  assert.doesNotMatch(workflow, /action-gh-release|create-release|gh release create/)
})

test('Tauri prepares the bundle exactly once', () => {
  const desktopPackage = readJson(new URL('../package.json', import.meta.url))
  const tauriConfig = readJson(new URL('../src-tauri/tauri.conf.json', import.meta.url))

  assert.equal(desktopPackage.scripts.dev, 'tauri dev')
  assert.equal(desktopPackage.scripts.build, 'node ./scripts/build-desktop.mjs')
  assert.deepEqual(tauriConfig.build.beforeDevCommand, {
    script: 'pnpm run bundle:prepare',
    wait: true,
  })
  assert.equal(tauriConfig.build.beforeBuildCommand, 'pnpm run bundle:prepare')
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

  assert.equal(config.bundle.macOS.entitlements, undefined)
  assert.deepEqual(config.bundle.externalBin, ['binaries/node'])
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/)
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/)
})

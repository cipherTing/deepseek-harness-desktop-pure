import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = resolve(desktopDir, 'src-tauri')
const { version } = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}

function signMacSidecarInDmg(sourceDmg) {
  const config = JSON.parse(readFileSync(resolve(tauriDir, 'tauri.conf.json'), 'utf8'))
  if (config.bundle.macOS.signingIdentity !== '-') {
    throw new Error('The sidecar signing step currently supports only the configured ad-hoc macOS identity')
  }

  const temporary = mkdtempSync(join(tmpdir(), 'dsh-desktop-sign-'))
  const writableDmg = resolve(temporary, 'bundle-rw.dmg')
  const signedDmg = resolve(temporary, 'bundle-signed.dmg')
  const mount = resolve(temporary, 'mount')
  const entitlements = resolve(tauriDir, 'node-entitlements.plist')
  mkdirSync(mount)
  let attached = false

  try {
    run('hdiutil', ['convert', sourceDmg, '-format', 'UDRW', '-o', writableDmg])
    run('hdiutil', ['attach', '-nobrowse', '-noverify', '-owners', 'on', '-mountpoint', mount, writableDmg])
    attached = true

    const apps = readdirSync(mount, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    if (apps.length !== 1) throw new Error(`Expected one app bundle in ${mount}, found ${apps.length}`)

    const app = resolve(mount, apps[0].name)
    const signedApp = resolve(temporary, apps[0].name)
    run('ditto', [app, signedApp])

    const node = resolve(signedApp, 'Contents', 'MacOS', 'node')
    run('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, node])
    run('codesign', ['--force', '--sign', '-', '--options', 'runtime', signedApp])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', signedApp])

    rmSync(app, { recursive: true, force: true })
    run('ditto', [signedApp, app])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app])

    run('hdiutil', ['detach', mount])
    attached = false
    run('hdiutil', ['convert', writableDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', signedDmg])
    return { path: signedDmg, cleanup: () => { rmSync(temporary, { recursive: true, force: true }) } }
  } catch (error) {
    if (attached) spawnSync('hdiutil', ['detach', '-force', mount], { stdio: 'inherit' })
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

const platform = (() => {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return {
      target: 'aarch64-apple-darwin',
      bundle: 'dmg',
      extension: '.dmg',
      artifactName: `deepseek-harness-desktop-macos-arm64-${version}.dmg`,
    }
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    return {
      target: 'x86_64-pc-windows-msvc',
      bundle: 'nsis',
      extension: '.exe',
      artifactName: `deepseek-harness-desktop-windows-x64-${version}.exe`,
    }
  }

  throw new Error(`Desktop builds support only macOS arm64 and Windows x64; received ${process.platform} ${process.arch}`)
})()

const bundleDir = resolve(tauriDir, 'target', platform.target, 'release', 'bundle', platform.bundle)
rmSync(bundleDir, { recursive: true, force: true })

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
run(
  pnpm,
  ['exec', 'tauri', 'build', '--target', platform.target, '--bundles', platform.bundle],
  { cwd: desktopDir, env: process.env },
)

const artifacts = readdirSync(bundleDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(platform.extension))
  .map((entry) => resolve(bundleDir, entry.name))

if (artifacts.length !== 1) {
  throw new Error(`Expected one ${platform.bundle} artifact in ${bundleDir}, found ${artifacts.length}`)
}

const distDir = resolve(desktopDir, 'dist')
const destination = resolve(distDir, platform.artifactName)
mkdirSync(distDir, { recursive: true })
const prepared = process.platform === 'darwin'
  ? signMacSidecarInDmg(artifacts[0])
  : { path: artifacts[0], cleanup: () => {} }
try {
  copyFileSync(prepared.path, destination)
} finally {
  prepared.cleanup()
}
process.stdout.write(`${destination}\n`)

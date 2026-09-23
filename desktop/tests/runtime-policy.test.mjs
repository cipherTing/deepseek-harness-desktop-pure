import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'
import { runtimeFileExclusion } from '../scripts/runtime-file-policy.mjs'

const desktop = resolve(import.meta.dirname, '..')
const runtime = resolve(desktop, 'src-tauri/rt')
const target = { platform: process.platform, arch: process.arch }
const otherPlatform = target.platform === 'win32' ? 'darwin-arm64' : 'win32-x64'

test('the runtime policy omits build, declaration, install and other-platform files only', () => {
  for (const [path, reason] of [
    ['node_modules/pako/dist/pako.js.map', 'source map'],
    ['lib/sidecar.mjs.map', 'source map'],
    ['node_modules/@deepseek-ai/dsh-settings/lib/types/index.d.ts', 'type declaration'],
    ['node_modules/typescript/lib/tsconfig.tsbuildinfo', 'TypeScript build cache'],
    ['node_modules/.modules.yaml', 'package-manager state'],
    ['node_modules/.pnpm/lock.yaml', 'package-manager state'],
    ['node_modules/.bin/pnpm', 'package-manager state'],
    ['pnpm-lock.yaml', 'package-manager state'],
    ['pnpm-workspace.yaml', 'package-manager state'],
    ['node_modules/@mixmark-io/domino/test/tests.js', 'Domino test fixtures'],
    [`node_modules/node-pty/prebuilds/${otherPlatform}/pty.node`, 'node-pty other platform'],
  ]) {
    assert.equal(runtimeFileExclusion(path, target), reason, path)
  }
  for (const kept of [
    'lib/sidecar.mjs',
    'overlay.yml',
    'package.json',
    `node_modules/node-pty/prebuilds/${target.platform}-${target.arch}/pty.node`,
    'node_modules/pnpm/bin/pnpm.mjs',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
    'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
    'node_modules/@deepseek-ai/dsh-skill-office/README.md',
    'node_modules/@deepseek-ai/dsh-settings/LICENSE',
  ]) {
    assert.equal(runtimeFileExclusion(kept, target), undefined, kept)
  }
})

test('the built runtime ships only runtime files under a plain manifest', () => {
  const sidecar = join(runtime, 'lib/sidecar.mjs')
  assert.equal(existsSync(sidecar), true, 'deployed sidecar is missing')

  const offenders = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const reason = runtimeFileExclusion(relative(runtime, path), target)
      if (reason !== undefined) {
        offenders.push(`${relative(runtime, path)} (${reason})`)
        continue
      }
      if (entry.isDirectory()) walk(path)
    }
  }
  walk(runtime)
  assert.deepEqual(offenders.slice(0, 10), [], `deployed runtime still ships pruned files (${offenders.length})`)

  for (const kept of [
    join(runtime, 'overlay.yml'),
    join(runtime, 'node_modules/pnpm/bin/pnpm.mjs'),
    join(runtime, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'),
    join(runtime, 'node_modules/@deepseek-ai/dsh-deepseek-account/package.json'),
    join(runtime, 'node_modules/@deepseek-ai/dsh-hook-protocol/package.json'),
    join(runtime, 'node_modules/@deepseek-ai/dsh-sdk-protocol/package.json'),
    join(runtime, `node_modules/node-pty/prebuilds/${target.platform}-${target.arch}`),
  ]) {
    assert.equal(existsSync(kept), true, `deployed runtime must keep ${relative(runtime, kept)}`)
  }

  const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@deepseek-ai/dsh-desktop-runtime')
  assert.match(manifest.version, /^\d+\.\d+\.\d+/u)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.exports['.'], './lib/sidecar.mjs')
  // Profile boot anchors its runtime resolution here, so the names stay.
  assert.ok(Object.keys(manifest.dependencies).length > 40)
  assert.doesNotMatch(JSON.stringify(manifest.dependencies), /file:|link:/u)
})

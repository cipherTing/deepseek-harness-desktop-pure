import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const desktop = resolve(import.meta.dirname, '..')
const runtime = resolve(desktop, 'src-tauri/rt')
const packages = join(runtime, 'node_modules', '@deepseek-ai')
const enginePackage = `libreoffice-kit-${process.platform}-${process.arch}`
// Linux owns no native engine target, so its builds carry the Wasm engine.
const deployedEnginePackage = process.platform === 'linux' ? 'libreoffice-kit-wasm' : enginePackage
const officeSkills = ['office', 'office-docx', 'office-xlsx', 'office-pptx',
  'office-render', 'office-recalculate', 'office-export-pdf']

test('the Desktop overlay mounts the carrier-owned Office composition', () => {
  const overlay = readFileSync(new URL('../runtime/overlay.yml', import.meta.url), 'utf8')
  // Ordinary Web leaves Office authoring to its carrier, so the Desktop
  // composition, not the web bundle, owns this row.
  assert.match(overlay, /- id: desktop-office\n\s+name: '@deepseek-ai\/dsh-desktop-runtime\/office'/)
  const webPatch = readFileSync(new URL('../../packages/bundle/web-app/cordis.patch.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(webPatch, /dsh-skill-office/, 'the web bundle must leave Office composition to its carrier')
})

test('the deployed runtime carries the Office payload the row resolves', () => {
  const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
  assert.equal(manifest.exports['./office'], './lib/office.mjs')
  for (const path of [
    join(runtime, 'lib/office.mjs'),
    join(packages, 'libreoffice-kit', 'lib', 'cli.js'),
    join(packages, 'libreoffice-kit', 'package.json'),
    join(packages, enginePackage, 'package.json'),
  ]) {
    assert.equal(existsSync(path), true, `${path} must ship in the deployed runtime`)
  }
  for (const name of officeSkills) {
    assert.equal(existsSync(join(packages, 'dsh-skill-office', 'assets', name, 'SKILL.md')), true,
      `Office skill ${name} must ship in the deployed runtime`)
  }
})

test('the Office row supplies the skills with this deploy\'s own assets, Node, and engine CLI', async () => {
  const office = await import(pathToFileURL(join(runtime, 'lib', 'office.mjs')).href)
  assert.equal(office.name, 'desktop-office')
  const mounted = []
  await office.apply({ plugin: async (module, config) => { mounted.push({ module, config }) } })
  assert.equal(mounted.length, 1)
  const { config } = mounted[0]
  assert.equal(config.assetRoot, join(packages, 'dsh-skill-office', 'assets'))
  assert.equal(config.cli, join(packages, 'libreoffice-kit', 'lib', 'cli.js'))
  // The skills execute the engine through the application's own Node.
  assert.equal(config.node, process.execPath)
})

test('the deployed engine resolves a backend for this platform', async () => {
  const require = createRequire(join(runtime, 'package.json'))
  const office = await import(require.resolve('@deepseek-ai/libreoffice-kit'))
  const discovered = await office.discoverRuntime()
  assert.equal(discovered.backend, process.platform === 'linux' ? 'wasm' : 'native')
  assert.equal(existsSync(join(packages, deployedEnginePackage)), true, `${deployedEnginePackage} must ship`)
  assert.equal(discovered.cliPath, join(packages, 'libreoffice-kit', 'lib', 'cli.js'))
})

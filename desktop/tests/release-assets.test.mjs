import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/build-desktop.yml', import.meta.url), 'utf8')
const block = workflow.match(/name: Prepare versioned release assets[\s\S]*?run: \|\n([\s\S]*?)(?=\n      - name:)/)?.[1]
assert.ok(block, 'release asset preparation step is missing')
const script = block.split('\n').map(line => line.replace(/^          /, '')).join('\n')
const inputs = ['mac.dmg', 'windows.exe', 'linux.deb', 'linux.AppImage']
const options = { skip: process.platform === 'win32' && 'Release staging uses Bash in the Ubuntu publish job' }

function run(t, names) {
  const directory = mkdtempSync(join(tmpdir(), 'deepdive-release-assets-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'release-input'))
  for (const name of names) writeFileSync(join(directory, 'release-input', name), name)
  const result = spawnSync('bash', ['-c', script], {
    cwd: directory, env: { ...process.env, VERSION: '1.2.3' }, encoding: 'utf8', timeout: 10_000,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return { directory, result }
}

test('release assets retain all four packages under versioned names', options, (t) => {
  const { directory, result } = run(t, inputs)
  assert.equal(result.status, 0, result.stderr)
  const expected = [
    ['deepdive-macos-arm64-1.2.3.dmg', 'mac.dmg'],
    ['deepdive-windows-x64-1.2.3.exe', 'windows.exe'],
    ['deepdive-linux-x64-1.2.3.deb', 'linux.deb'],
    ['deepdive-linux-x64-1.2.3.AppImage', 'linux.AppImage'],
  ]
  assert.deepEqual(readdirSync(join(directory, 'release-assets')).sort(), expected.map(([name]) => name).sort())
  for (const [name, content] of expected) {
    assert.equal(readFileSync(join(directory, 'release-assets', name), 'utf8'), content)
  }
})

for (const omitted of inputs) {
  test(`release preparation rejects a missing ${omitted}`, options, (t) => {
    const { result } = run(t, inputs.filter(name => name !== omitted))
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Expected exactly one DMG, one EXE, one DEB and one AppImage artifact/)
  })
}

test('release preparation rejects duplicate Linux bundles', options, (t) => {
  const { result } = run(t, [...inputs, 'duplicate.AppImage'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Expected exactly one DMG, one EXE, one DEB and one AppImage artifact/)
})

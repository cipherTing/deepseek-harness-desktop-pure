import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { decode, encode } from '@msgpack/msgpack'

const desktop = resolve(import.meta.dirname, '..')
const triple = process.platform === 'darwin' && process.arch === 'arm64'
  ? 'aarch64-apple-darwin'
  : process.platform === 'win32' && process.arch === 'x64'
    ? 'x86_64-pc-windows-msvc'
    : undefined

test('bundled Node sidecar serves the loopback web host', { timeout: 120_000, skip: triple === undefined }, async () => {
  const dshHome = await mkdtemp(resolve(tmpdir(), 'dsh-desktop-smoke-'))
  const executable = resolve(desktop, `src-tauri/binaries/node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
  const sidecar = resolve(desktop, 'src-tauri/rt/lib/sidecar.mjs')
  const clientUi = resolve(desktop, 'src-tauri/rt/node_modules/@deepseek-ai/dsh-desktop-client-ui/lib')
  assert.equal(existsSync(join(clientUi, 'index.js')), true, 'deployed client-ui Host entry is missing')
  assert.equal(existsSync(join(clientUi, 'client.js')), true, 'deployed client-ui Web entry is missing')
  const child = spawn(executable, [sidecar], {
    cwd: homedir(),
    env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exitPromise = new Promise((resolveExit, reject) => {
    child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    child.once('error', reject)
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  let exited
  child.once('exit', (code, signal) => { exited = { code, signal } })
  let buffer = Buffer.alloc(0)
  const messages = []
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (buffer.length < length + 4) break
      messages.push(decode(buffer.subarray(4, length + 4)))
      buffer = buffer.subarray(length + 4)
    }
  })
  const send = (message) => {
    const request = encode(message)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(request.byteLength)
    child.stdin.write(Buffer.concat([header, request]))
  }
  try {
    const ready = await waitFor(() => {
      const message = messages.find(candidate => candidate.kind === 'ready' || candidate.kind === 'fatal')
      if (message !== undefined) return message
      if (exited !== undefined) throw new Error(`sidecar exited before ready: ${JSON.stringify(exited)}\n${stderr}`)
      return undefined
    })
    assert.equal(ready.kind, 'ready', stderr || ready.error)
    assert.equal(ready.protocolVersion, 1)
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    const origin = ready.url

    // The index document is the REAL web host's per-request output: it carries
    // the fresh boot manifest plus the desktop index taps.
    const index = await fetch(`${origin}/`)
    assert.equal(index.status, 200)
    const html = await index.text()
    assert.match(html, /window\.__DSH_BOOT__/)
    assert.match(html, /desktop-bridge\.js/)
    assert.match(html, /html,body\{overscroll-behavior:none\}/)

    // The bridge script route is served by the desktop surface plugin.
    const bridge = await fetch(`${origin}/desktop-bridge.js`)
    assert.equal(bridge.status, 200)
    assert.match(bridge.headers.get('content-type') ?? '', /text\/javascript/)
    assert.match(await bridge.text(), /desktop_save_session/)

    // Desktop facts for the About section and the update badge.
    const desktopInfo = await fetch(`${origin}/desktop-info.json`)
    assert.equal(desktopInfo.status, 200)
    const info = await desktopInfo.json()
    assert.equal(typeof info.desktopVersion, 'string')
    assert.equal(info.repository, 'https://github.com/cipherTing/deepseek-harness-desktop-pure')
    assert.equal(typeof info.author, 'string')

    // Plugin bundles come from the live module table with the manifest rev.
    const manifest = JSON.parse(html.match(/window\.__DSH_BOOT__ = (.*?)<\/script>/s)[1])
    const nativePicker = manifest.entries.find(entry => (
      entry.id === '@deepseek-ai/dsh-client-ui-directory-picker-native'))
    assert.ok(nativePicker !== undefined, 'desktop overlay must keep the native picker entry')
    const clientUi = manifest.entries.find(entry => (
      entry.id === '@deepseek-ai/dsh-desktop-client-ui'))
    assert.ok(clientUi !== undefined, 'desktop overlay must mount the desktop client UI entry')
    const bundle = await fetch(`${origin}${nativePicker.url}`)
    assert.equal(bundle.status, 200)
    assert.match(bundle.headers.get('content-type') ?? '', /text\/javascript/)
    const clientUiBundle = await fetch(`${origin}${clientUi.url}`)
    assert.equal(clientUiBundle.status, 200)
    assert.match(await clientUiBundle.text(), /desktop_save_session|settings\.section/)

    // The /api transport and the system bridge roundtrip over real HTTP.
    const pickBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-picker', method: 'host.pickDirectory', payload: {},
    }))
    const pickPromise = fetch(`${origin}/api/host.pickDirectory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: pickBody,
    })
    const systemRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.method === 'pick-directory'))
    send({ kind: 'system-response', id: systemRequest.id, ok: true, payload: null })
    const pickerResponse = await pickPromise
    assert.equal(pickerResponse.status, 200)
    assert.deepEqual((await pickerResponse.json()).result, {
      ok: true, value: { path: null },
    })

    const openBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-open', method: 'host.openPath', payload: { path: '/tmp' },
    }))
    const openPromise = fetch(`${origin}/api/host.openPath`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: openBody,
    })
    const openRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.method === 'open-path'))
    send({ kind: 'system-response', id: openRequest.id, ok: true, payload: null })
    const openResponse = await openPromise
    assert.equal(openResponse.status, 200)

    // Cancellation propagates end to end: aborting the page fetch tears down
    // the in-flight system request, which announces itself as system-cancel.
    const cancelController = new AbortController()
    const cancelledBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-picker-cancelled', method: 'host.pickDirectory', payload: {},
    }))
    const cancelledPromise = fetch(`${origin}/api/host.pickDirectory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cancelledBody,
      signal: cancelController.signal,
    })
    // Attach the settlement handler immediately so an abort-triggered
    // rejection is never observed unhandled before the assertion below.
    const cancelledOutcome = cancelledPromise.then(
      () => 'fulfilled',
      () => 'rejected',
    )
    const cancelledSystemRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.id !== systemRequest.id && message.method === 'pick-directory'))
    cancelController.abort()
    await waitFor(() => messages.find(message =>
      message.kind === 'system-cancel' && message.id === cancelledSystemRequest.id))
    assert.equal(await cancelledOutcome, 'rejected')

    // The session-export endpoint answers over the plain loopback transport
    // (the Rust shell streams it to disk itself — no protocol stream carrier).
    const exportResponse = await fetch(`${origin}/api/session.export?sessionId=smoke-missing`)
    assert.equal(typeof exportResponse.status, 'number')

    send({ kind: 'request', id: 8, method: 'shutdown', payload: {} })
    await waitFor(() => messages.find(message => message.kind === 'response' && message.id === 8))
    const exit = await exitPromise
    assert.equal(exit.signal, null)
    assert.equal(exit.code, 0, stderr)
  } finally {
    if (child.exitCode === null) child.kill()
    await rm(dshHome, { recursive: true, force: true })
  }
})

async function waitFor(read, timeoutMs = 110_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error('timed out waiting for sidecar protocol message')
}

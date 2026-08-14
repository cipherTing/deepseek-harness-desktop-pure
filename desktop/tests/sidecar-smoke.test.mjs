import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { decode, encode } from '@msgpack/msgpack'

const desktop = resolve(import.meta.dirname, '..')
const triple = process.platform === 'darwin' && process.arch === 'arm64'
  ? 'aarch64-apple-darwin'
  : process.platform === 'win32' && process.arch === 'x64'
    ? 'x86_64-pc-windows-msvc'
    : undefined

test('bundled Node sidecar reaches ready without a Web listener', { timeout: 120_000, skip: triple === undefined }, async () => {
  const dshHome = await mkdtemp(resolve(tmpdir(), 'dsh-desktop-smoke-'))
  const executable = resolve(desktop, `src-tauri/binaries/node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
  const sidecar = resolve(desktop, 'src-tauri/resources/runtime/lib/sidecar.mjs')
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
    assert.ok(Array.isArray(ready.graph.entries) && ready.graph.entries.length > 0)
    assert.ok(ready.graph.entries.some(entry =>
      entry.id === '@deepseek-ai/dsh-client-ui-directory-picker-native'))
    assert.match(ready.indexHtml, /desktop-bridge\.js/)
    assert.match(ready.indexHtml, /html,body\{overscroll-behavior:none\}/)
    assert.match(ready.indexHtml, /window\.__DSH_BOOT__/)

    for (const [id, path] of [[1, '/api/events.mux'], [2, '/api/events.host']]) {
      send({ kind: 'request', id, method: 'stream.events', payload: { path } })
      const opened = await waitFor(() => messages.find(message => message.kind === 'response' && message.id === id))
      assert.equal(opened.ok, true)
      send({ kind: 'credit', streamId: opened.payload.streamId, count: 1 })
      await waitFor(() => messages.find(message =>
        message.kind === 'stream-open' && message.streamId === opened.payload.streamId))
      send({ kind: 'cancel', streamId: opened.payload.streamId })
    }

    send({ kind: 'request', id: 3, method: 'stream.events', payload: { path: '/api/events.missing' } })
    const rejectedStream = await waitFor(() => messages.find(message => message.kind === 'response' && message.id === 3))
    assert.equal(rejectedStream.ok, false)

    const body = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-picker', method: 'host.pickDirectory', payload: {},
    }))
    send({
      kind: 'request', id: 4, method: 'http.fetch',
      payload: {
        method: 'POST', url: '/api/host.pickDirectory',
        headers: { 'content-type': 'application/json' }, body,
      },
    })
    const systemRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.method === 'pick-directory'))
    send({ kind: 'system-response', id: systemRequest.id, ok: true, payload: null })
    const pickerResponse = await waitFor(() => messages.find(message => message.kind === 'response' && message.id === 4))
    assert.equal(pickerResponse.ok, true)
    assert.deepEqual(JSON.parse(Buffer.from(pickerResponse.payload.body).toString('utf8')).result, {
      ok: true, value: { path: null },
    })

    const openBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-open', method: 'host.openPath', payload: { path: '/tmp' },
    }))
    send({
      kind: 'request', id: 5, method: 'http.fetch',
      payload: {
        method: 'POST', url: '/api/host.openPath',
        headers: { 'content-type': 'application/json' }, body: openBody,
      },
    })
    const openRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.method === 'open-path'))
    send({ kind: 'system-response', id: openRequest.id, ok: true, payload: null })
    const openResponse = await waitFor(() => messages.find(message => message.kind === 'response' && message.id === 5))
    assert.equal(openResponse.ok, true)

    const cancelledBody = Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'desktop-picker-cancelled', method: 'host.pickDirectory', payload: {},
    }))
    send({
      kind: 'request', id: 6, method: 'http.fetch',
      payload: {
        method: 'POST', url: '/api/host.pickDirectory',
        headers: { 'content-type': 'application/json' }, body: cancelledBody,
      },
    })
    const cancelledSystemRequest = await waitFor(() => messages.find(message =>
      message.kind === 'system-request' && message.id !== systemRequest.id && message.method === 'pick-directory'))
    send({ kind: 'request-cancel', id: 6 })
    await waitFor(() => messages.find(message =>
      message.kind === 'system-cancel' && message.id === cancelledSystemRequest.id))
    const cancelledResponse = await waitFor(
      () => messages.find(message => message.kind === 'response' && message.id === 6),
      10_000,
    )
    assert.equal(cancelledResponse.ok, false)
    assert.match(cancelledResponse.error, /AbortError|aborted|cancelled/i)

    send({ kind: 'request', id: 7, method: 'shutdown', payload: {} })
    await waitFor(() => messages.find(message => message.kind === 'response' && message.id === 7))
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

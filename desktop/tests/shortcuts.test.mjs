import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const sources = {
  '@deepseek-ai/dsh-client-shortcuts/protocol': '../../packages/client/shortcuts/src/protocol.ts',
  '@deepseek-ai/dsh-util-values': '../../packages/util/values/src/index.ts',
  '@deepseek-ai/dsh-util-crypto': '../../packages/util/crypto/src/index.ts',
}
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../bridge/src/shortcuts.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'shortcutModule', platform: 'browser',
  plugins: [{
    name: 'shortcut-test-host',
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\// }, ({ path }) => ({ path, namespace: 'tauri-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'tauri-test' }, ({ path }) => ({ contents: path.endsWith('/core')
        ? 'export const invoke = (...args) => window.shortcutHost.invoke(...args)'
        : path.endsWith('/event')
          ? 'export const listen = (...args) => window.shortcutHost.listen(...args)'
          : 'export const getCurrentWindow = () => window.shortcutHost.currentWindow' }))
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-/ }, ({ path }) => ({
        path: fileURLToPath(new URL(sources[path], import.meta.url)),
      }))
    },
  }],
})

const documents = new Set()
const carriers = new Set()
afterEach(() => {
  for (const carrier of carriers) carrier.dispose()
  carriers.clear()
  for (const dom of documents) dom.window.close()
  documents.clear()
})

const definitions = [{ id: 'session.new', defaults: {
  'desktop:macos': { code: 'KeyN', modifiers: ['primary'] },
  'desktop:windows': { code: 'KeyN', modifiers: ['primary'] },
} }]
const flush = async () => { await new Promise(resolve => setImmediate(resolve)) }

function fixture({ platform = 'macos', configure = async () => {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
  documents.add(dom)
  const { window } = dom
  Object.defineProperty(window.navigator, 'userAgent', { value: platform === 'macos' ? 'Macintosh' : 'Windows' })
  const configurations = []
  const eventListeners = new Map()
  let raw = null
  let closed = 0
  window.shortcutHost = {
    invoke: async (command, args) => {
      if (command === 'desktop_keybindings_read') return raw
      if (command === 'desktop_keybindings_write') { raw = args.document; return }
      assert.equal(command, 'desktop_keyboard_configure')
      const configuration = structuredClone(args.configuration)
      configurations.push(configuration)
      await configure(configuration)
    },
    listen: async (name, listener) => {
      eventListeners.set(name, listener)
      return () => { eventListeners.delete(name) }
    },
    currentWindow: { close: async () => { closed++ } },
  }
  window.eval(`${bundled.outputFiles[0].text}\nwindow.shortcutModule = shortcutModule`)
  const carrier = window.shortcutModule.installShortcuts()
  carriers.add(carrier)
  return {
    window, carrier, configurations, closed: () => closed,
    emit: input => eventListeners.get('desktop-shortcut-input')?.({ payload: input }),
    press: (code, options = {}) => {
      const event = new window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true,
        ...(platform === 'macos' ? { metaKey: true } : { ctrlKey: true }), ...options })
      window.dispatchEvent(event)
      return event
    },
  }
}

for (const platform of ['macos', 'windows']) {
  test(`${platform} shares effective bindings with native interception and dispatches the main DOM press once`, async () => {
    const { carrier, configurations, press, emit } = fixture({ platform })
    const received = []
    const unsubscribe = carrier.keyboard.subscribe(input => { received.push(input) })
    const initial = await carrier.shortcuts.get(definitions)
    assert.equal(configurations.at(-1).revision, initial.revision)
    assert.deepEqual(configurations.at(-1).bindings, [{ code: 'KeyN', modifiers: [platform === 'macos' ? 'meta' : 'control'] }])
    assert.equal(press('KeyN').defaultPrevented, true)
    assert.equal(received.length, 1)
    assert.equal(received[0].kind, 'keyboard')
    emit(received[0])
    assert.equal(received.length, 1, 'native must not duplicate the main document input')
    emit({ ...received[0], kind: 'iframe', frameName: 'preview', revision: 'stale' })
    assert.equal(received.length, 1)
    emit({ ...received[0], kind: 'iframe', frameName: 'preview' })
    assert.equal(received.length, 2)
    unsubscribe()
    emit({ ...received[0], kind: 'webview', frameName: 'guest' })
    press('KeyN')
    assert.equal(received.length, 2)
    const result = await carrier.shortcuts.edit({ type: 'set', id: 'session.new', binding: null }, initial.revision)
    assert.equal(result.status, 'saved')
    assert.deepEqual(configurations.at(-1).bindings, [])
    assert.equal(configurations.at(-1).revision, result.snapshot.revision)
    assert.equal(press('KeyN').defaultPrevented, false)
  })
}

test('reads, edits, and recording changes await installation in the native input owner', async () => {
  let unblock
  let gate = new Promise(resolve => { unblock = resolve })
  const { carrier, configurations } = fixture({ configure: async () => { await gate } })
  let complete = false
  const reading = carrier.shortcuts.get(definitions).then((value) => { complete = true; return value })
  await flush()
  assert.equal(complete, false)
  unblock()
  const initial = await reading
  gate = new Promise(resolve => { unblock = resolve })
  complete = false
  const editing = carrier.shortcuts.edit({ type: 'set', id: 'session.new', binding: null }, initial.revision)
    .then(() => { complete = true })
  await flush()
  assert.equal(complete, false)
  unblock()
  await editing
  gate = new Promise(resolve => { unblock = resolve })
  complete = false
  const recording = carrier.shortcuts.recording(true).then(() => { complete = true })
  await flush()
  assert.equal(complete, false)
  assert.equal(configurations.at(-1).recording, true)
  unblock()
  await recording
})

test('a consumed main-document shortcut release does not reach page keyup listeners', async () => {
  const { window, carrier, press } = fixture()
  await carrier.shortcuts.get(definitions)
  let observed = 0
  window.addEventListener('keyup', () => { observed++ })
  press('KeyN')
  const release = new window.KeyboardEvent('keyup', { code: 'KeyN', bubbles: true, cancelable: true, metaKey: true })
  window.dispatchEvent(release)
  assert.equal(release.defaultPrevented, true)
  assert.equal(observed, 0)
})

test('publishes trusted iframe focus including shadow roots and clears it after focus migration', async () => {
  const { window, carrier, configurations } = fixture()
  await carrier.shortcuts.get(definitions)
  const frame = window.document.createElement('iframe')
  frame.name = 'preview-lease'
  window.document.body.append(frame)
  frame.focus()
  await flush()
  assert.equal(configurations.at(-1).focus.kind, 'keyboard', 'an unmarked iframe is not trusted')
  frame.dataset.htmlPreview = ''
  window.dispatchEvent(new window.Event('blur'))
  await flush()
  assert.deepEqual(configurations.at(-1).focus, { kind: 'iframe', frameName: 'preview-lease' })
  const field = window.document.createElement('input')
  window.document.body.append(field)
  field.focus()
  await flush()
  assert.deepEqual(configurations.at(-1).focus, { kind: 'keyboard', frameName: '' })
  const host = window.document.createElement('div')
  window.document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const nestedFrame = window.document.createElement('iframe')
  nestedFrame.name = 'browser-frame'
  nestedFrame.dataset.sidebarBrowserFrame = ''
  shadow.append(nestedFrame)
  nestedFrame.focus()
  await flush()
  assert.deepEqual(configurations.at(-1).focus, { kind: 'iframe', frameName: 'browser-frame' })
  nestedFrame.remove()
  await flush()
  assert.deepEqual(configurations.at(-1).focus, { kind: 'keyboard', frameName: '' })
})

test('recording and onboarding disable native dispatch, and onboarding also contains DOM keys and close requests', async () => {
  const { carrier, configurations, press, emit, closed } = fixture()
  const initial = await carrier.shortcuts.get(definitions)
  const received = []
  carrier.keyboard.subscribe(input => { received.push(input) })
  const native = { kind: 'webview', revision: initial.revision, frameName: 'guest', code: 'KeyN',
    control: false, alt: false, shift: false, meta: true, repeat: false }
  await carrier.shortcuts.recording(true)
  emit(native)
  assert.equal(press('KeyN').defaultPrevented, false, 'the recorder receives raw main-document keys')
  await carrier.keyboard.closeWindow(initial.revision)
  assert.equal(closed(), 0)
  assert.equal(received.length, 0)
  await carrier.shortcuts.recording(false)
  carrier.setBlocked(true)
  await flush()
  assert.equal(configurations.at(-1).blocked, true)
  emit(native)
  assert.equal(press('KeyN').defaultPrevented, true)
  assert.equal(received.length, 0)
  await carrier.keyboard.closeWindow(initial.revision)
  assert.equal(closed(), 0)
  carrier.setBlocked(false)
  await flush()
  emit(native)
  assert.equal(received.length, 1)
  await carrier.keyboard.closeWindow(initial.revision)
  assert.equal(closed(), 1)
})

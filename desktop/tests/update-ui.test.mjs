import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { JSDOM } from 'jsdom'

const clientSource = readFileSync(new URL('../client-ui/src/client.js', import.meta.url), 'utf8')

let dom

afterEach(() => {
  cleanup()
  dom?.window.close()
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent']) {
    delete globalThis[name]
  }
  delete globalThis.fetch
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

function response(value) {
  return { ok: true, json: async () => value }
}

function dragEvent(type, dataTransfer, { x = 480, y = 320 } = {}) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: x },
    clientY: { value: y },
  })
  return event
}

function fileTransfer(types, { files = [], items = types.map(type => ({ kind: 'file', type })) } = {}) {
  return { types: ['Files'], files, items, dropEffect: 'copy' }
}

function rect({ left, top, right, bottom }) {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function installShellAndDropOverlay() {
  const frame = document.createElement('div')
  const sidebar = document.createElement('div')
  const center = document.createElement('div')
  const overlayLayer = document.createElement('div')
  overlayLayer.dataset.shellOverlay = ''
  frame.append(sidebar, center, overlayLayer)
  document.body.appendChild(frame)
  Object.defineProperty(frame, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect({ left: 0, top: 0, right: 1200, bottom: 720 }),
  })
  Object.defineProperty(sidebar, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect({ left: 0, top: 0, right: 320, bottom: 720 }),
  })

  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'status')
  overlay.dataset.dshDropAccepting = 'true'
  const wrap = document.createElement('div')
  wrap.append(document.createElement('div'), document.createElement('div'), document.createElement('div'))
  overlay.appendChild(wrap)
  document.body.appendChild(overlay)
  return { overlay }
}

function loadClientUi({
  currentVersion = '0.1.6',
  releaseVersion = '0.2.0',
  releaseBody = '## 更新日志\n\n- 新增更新弹窗。',
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  activate = true,
} = {}) {
  const releaseTag = `v${releaseVersion}`
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1:41000/',
  })
  Object.defineProperty(dom.window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: dom.window[name],
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === '/desktop-info.json') {
      return response({
        desktopVersion: currentVersion,
        kernelVersion: '0.1.1-rc.2',
        repository: 'https://github.com/cipherTing/deepseek-harness-desktop-pure',
        author: 'cipherTing',
      })
    }
    if (url.endsWith('/repos/cipherTing/deepseek-harness-desktop-pure/releases/latest')) {
      return response({
        tag_name: releaseTag,
        html_url: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/tag/${releaseTag}`,
        body: releaseBody,
        assets: [{
          name: `deepdive-macos-arm64-${releaseVersion}.dmg`,
          browser_download_url: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/${releaseTag}/deepdive-macos-arm64-${releaseVersion}.dmg`,
        }, {
          name: `deepdive-windows-x64-${releaseVersion}.exe`,
          browser_download_url: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/${releaseTag}/deepdive-windows-x64-${releaseVersion}.exe`,
        }],
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  let handoff
  dom.window.__ModuleLoader__ = {
    load(value) { handoff = value },
  }
  Function(clientSource)()
  assert.ok(handoff)

  const primitives = {
    Button: ({ children, icon, variant: _variant, size: _size, ...props }) => React.createElement(
      'button', props, icon, children),
    IconChevronRightOutline14: () => React.createElement('span', { 'aria-hidden': 'true' }, '>'),
    IconDownloadOutline16: () => React.createElement('span', { 'aria-hidden': 'true' }, 'download'),
    MarkdownText: ({ text }) => React.createElement('div', { 'data-testid': 'release-markdown' }, text),
    Modal: ({ open, title, children, footer, className, contentClassName }) => open
      ? React.createElement('div', { role: 'dialog', 'aria-label': title, className },
        React.createElement('div', { className: contentClassName }, children),
        React.createElement('div', { 'data-testid': 'modal-footer' }, footer))
      : null,
  }
  const plugin = handoff.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected module: ${id}`)
  })

  let dictionaries
  const components = new Map()
  const locale = {
    register: (_namespace, value) => { dictionaries = value; return () => {} },
    bind: () => (key, values = {}) => String(dictionaries.zh[key]).replace(
      /\{([^}]+)\}/g, (_match, name) => String(values[name] ?? '')),
    getSnapshot: () => ({ active: 'zh' }),
    subscribe: () => () => {},
  }
  const slots = {
    inject: (_name, register) => register(),
    register: (entry, component) => { components.set(entry.name, component); return () => {} },
  }
  const context = {
    locale,
    slots,
    effect: (install) => install(),
    get: (name) => name === 'locale' ? locale : name === 'slots' ? slots : undefined,
  }
  if (activate) plugin.apply(context)
  const t = locale.bind()
  return { components, t, locale, slots, plugin }
}

test('Desktop client UI waits for locale and slots before registering its contributions', async () => {
  const { components, locale, slots, plugin } = loadClientUi({ activate: false })
  assert.deepEqual(plugin.inject, ['locale', 'slots'])

  // Use the built Cordis runtime used by the Desktop sidecar; a hand-written
  // context would not prove that a missing provider parks the plugin fiber.
  const { Context } = await import(new URL(
    '../src-tauri/rt/node_modules/@deepseek-ai/cordis/lib/index.js',
    import.meta.url,
  ))
  const ctx = new Context()
  const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply })
  try {
    await Promise.resolve()
    assert.equal(components.size, 0)

    ctx.provide('locale', locale)
    await Promise.resolve()
    assert.equal(components.size, 0)

    ctx.provide('slots', slots)
    await fiber
    assert.deepEqual([...components.keys()], [
      'settings.section',
      'settings.update',
      'sidebar.brand.name',
    ])
  } finally {
    await fiber.dispose()
  }
})

test('update badge opens release details only after the user clicks it', async () => {
  const notes = '## 更新日志\n\n- 支持展示 GitHub 更新内容。\n- 第二条更新。'
  const { components, t } = loadClientUi({ releaseBody: notes })
  const UpdateBadge = components.get('settings.update')
  assert.equal(typeof UpdateBadge, 'function')

  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  const update = await view.findByRole('button', { name: '更新' })
  assert.equal(view.queryByRole('dialog'), null)

  fireEvent.click(update)

  const dialog = await view.findByRole('dialog', { name: 'DeepDive 更新' })
  assert.match(dialog.textContent, /v0\.1\.6/)
  assert.match(dialog.textContent, /v0\.2\.0/)
  assert.equal(view.getByTestId('release-markdown').textContent, notes)
  const notesScroller = dialog.querySelector('.dab-releaseNotes')
  assert.ok(notesScroller)
  const start = view.getByRole('link', { name: /开始更新/ })
  assert.equal(
    start.getAttribute('href'),
    'https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/v0.2.0/deepdive-macos-arm64-0.2.0.dmg',
  )
  assert.match(clientSource, /\.dab-releaseNotes\{[^}]*max-height:[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/)
  assert.match(clientSource, /\.dab-updateDialogContent\{[^}]*min-height:0[^}]*flex:1 1 auto[^}]*overflow:hidden/)
  assert.match(clientSource, /\.dab-releaseSection\{[^}]*min-height:0[^}]*flex:1 1 auto/)
  assert.match(clientSource, /\.dab-releaseNotes\{[^}]*min-height:0[^}]*flex:1 1 auto[^}]*overflow-y:auto/)
  assert.ok(dialog.classList.contains('dab-updateDialog'))
  assert.ok(dialog.querySelector('.dab-updateDialogContent'))
  assert.ok(view.getByTestId('modal-footer').contains(start))
})

test('manual update check reports the release without opening the dialog', async () => {
  const { components, t } = loadClientUi()
  const AboutSection = components.get('settings.section')
  assert.equal(typeof AboutSection, 'function')

  const view = render(React.createElement(AboutSection, { t }))
  await view.findByText('0.1.6')
  fireEvent.click(view.getByRole('button', { name: '检查更新' }))

  await view.findByText('发现新版本 v0.2.0')
  assert.equal(view.queryByRole('dialog'), null)
  fireEvent.click(view.getByRole('button', { name: '查看更新' }))
  await waitFor(() => assert.ok(view.getByRole('dialog', { name: 'DeepDive 更新' })))
})

test('Windows update action targets the matching installer asset', async () => {
  const { components, t } = loadClientUi({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  })
  const UpdateBadge = components.get('settings.update')
  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  fireEvent.click(await view.findByRole('button', { name: '更新' }))

  const start = await view.findByRole('link', { name: /开始更新/ })
  assert.equal(
    start.getAttribute('href'),
    'https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/v0.2.0/deepdive-windows-x64-0.2.0.exe',
  )
})

test('Desktop file drops scope the overlay without replacing DSH admission', () => {
  loadClientUi()
  const { overlay } = installShellAndDropOverlay()
  const dataTransfer = fileTransfer(['image/png'])

  const enter = dragEvent('dragenter', dataTransfer)
  document.dispatchEvent(enter)
  assert.ok(document.documentElement.classList.contains('ddu-file-drag-active'))
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-left'), '320px')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-right'), '0px')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-top'), '0px')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-bottom'), `${String(window.innerHeight - 720)}px`)
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-enabled-copy'), '"松开即可添加"')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-blocked-copy'), '"当前无法添加"')
  assert.equal(enter.defaultPrevented, false)
  assert.equal(overlay.getAttribute('aria-label'), null)

  const over = dragEvent('dragover', dataTransfer)
  document.dispatchEvent(over)
  assert.equal(over.defaultPrevented, false)

  document.dispatchEvent(dragEvent('drop', dataTransfer))
  assert.equal(document.documentElement.classList.contains('ddu-file-drag-active'), false)
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-left'), '')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-enabled-copy'), '')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-blocked-copy'), '')
})

test('Desktop drag leave clears the scoped overlay state', () => {
  loadClientUi()
  installShellAndDropOverlay()
  const dataTransfer = fileTransfer(['image/png'])

  document.dispatchEvent(dragEvent('dragenter', dataTransfer))
  document.dispatchEvent(dragEvent('dragleave', dataTransfer))

  assert.equal(document.documentElement.classList.contains('ddu-file-drag-active'), false)
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-enabled-copy'), '')
  assert.equal(document.documentElement.style.getPropertyValue('--ddu-drop-blocked-copy'), '')
})

test('Desktop leaves file-type admission and drop propagation to DSH', () => {
  loadClientUi()
  installShellAndDropOverlay()
  let downstreamDrops = 0
  document.addEventListener('drop', () => { downstreamDrops += 1 })

  for (const dataTransfer of [
    fileTransfer(['application/pdf']),
    fileTransfer(['image/png', 'application/pdf']),
    fileTransfer(['']),
  ]) {
    const enter = dragEvent('dragenter', dataTransfer)
    document.dispatchEvent(enter)
    assert.equal(document.documentElement.classList.contains('ddu-file-drag-active'), true)
    const over = dragEvent('dragover', dataTransfer)
    document.dispatchEvent(over)
    const drop = dragEvent('drop', dataTransfer)
    document.dispatchEvent(drop)

    assert.equal(enter.defaultPrevented, false)
    assert.equal(over.defaultPrevented, false)
    assert.equal(drop.defaultPrevented, false)
    assert.equal(document.documentElement.classList.contains('ddu-file-drag-active'), false)
  }

  assert.equal(downstreamDrops, 3)
})

test('stable releases supersede prereleases without allowing a prerelease downgrade', async () => {
  const stableView = loadClientUi({ currentVersion: '0.2.0-rc.1', releaseVersion: '0.2.0' })
  const StableBadge = stableView.components.get('settings.update')
  const first = render(React.createElement(StableBadge, { wide: true, t: stableView.t }))
  await first.findByRole('button', { name: '更新' })
  cleanup()
  dom.window.close()

  const prereleaseView = loadClientUi({ currentVersion: '0.2.0', releaseVersion: '0.2.0-rc.1' })
  const PrereleaseAbout = prereleaseView.components.get('settings.section')
  const second = render(React.createElement(PrereleaseAbout, { t: prereleaseView.t }))
  await second.findByText('0.2.0')
  fireEvent.click(second.getByRole('button', { name: '检查更新' }))
  await second.findByText('已是最新版本（v0.2.0-rc.1）')
  assert.equal(second.queryByRole('button', { name: '查看更新' }), null)
})

test('numeric prerelease identifiers follow SemVer precedence', async () => {
  const { components, t } = loadClientUi({ currentVersion: '0.2.0-rc.1', releaseVersion: '0.2.0-rc.2' })
  const UpdateBadge = components.get('settings.update')
  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  await view.findByRole('button', { name: '更新' })
})

test('version comparison does not lose precision for large SemVer identifiers', async () => {
  const { components, t } = loadClientUi({
    currentVersion: '9007199254740992.0.0',
    releaseVersion: '9007199254740993.0.0',
  })
  const UpdateBadge = components.get('settings.update')
  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  await view.findByRole('button', { name: '更新' })
})

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
  delete globalThis.dshDesktop
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
  ignoredVersion,
  cli,
  releaseAvailable = true,
  releaseUnreachable = false,
  absentLatest = 'undefined',
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
  // The shell owns the release feed; the stub answers from this test's release
  // facts and counts reads, so a badge cannot quietly poll by itself.
  let releaseReads = 0
  const releaseReport = () => ({
    version: currentVersion,
    // The shell serialises an absent release as `null`; both spellings mean
    // "this build is current" and neither may offer a version.
    ...releaseAvailable ? {
      latest: releaseVersion.replace(/^v/i, ''),
      notes: releaseBody,
      page: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/tag/${releaseTag}`,
      assets: {
        macos: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/${releaseTag}/deepdive-macos-arm64-${releaseVersion}.dmg`,
        windows: `https://github.com/cipherTing/deepseek-harness-desktop-pure/releases/download/${releaseTag}/deepdive-windows-x64-${releaseVersion}.exe`,
      },
    } : { latest: absentLatest === 'null' ? null : undefined },
  })
  const release = {
    state: async () => { releaseReads += 1; return releaseReport() },
    check: async () => {
      releaseReads += 1
      if (releaseUnreachable) throw new Error('the release feed is unreachable')
      return releaseReport()
    },
  }
  globalThis.dshDesktop = { release, ...cli === undefined ? {} : { cli } }
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
    IconChevronRightOutlineRegular: () => React.createElement('span', { 'aria-hidden': 'true' }, '>'),
    IconDownloadOutlineRegular: () => React.createElement('span', { 'aria-hidden': 'true' }, 'download'),
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
  // The durable Desktop preference behind the update badge: the stub records
  // every write and republishes the section it now holds.
  const ignored = { value: ignoredVersion, writes: [], listeners: new Set() }
  const configFormEntry = {
    getSnapshot: () => ({
      value: ignored.value === undefined ? undefined : { ignoredUpdateVersion: ignored.value },
    }),
    subscribe: (listener) => { ignored.listeners.add(listener); return () => { ignored.listeners.delete(listener) } },
    set: (field, value) => {
      assert.equal(field, 'ignoredUpdateVersion')
      ignored.writes.push(value)
      ignored.value = value
      for (const listener of ignored.listeners) listener()
      return Promise.resolve()
    },
  }
  const configForms = { get: () => configFormEntry }
  const context = {
    locale,
    slots,
    configForms,
    effect: (install) => install(),
    get: (name) => name === 'locale' ? locale : name === 'slots' ? slots
      : name === 'configForms' ? configForms : undefined,
  }
  if (activate) plugin.apply(context)
  const t = locale.bind()
  return { components, t, locale, slots, plugin, ignored, cli, releaseReads: () => releaseReads }
}

test('Desktop client UI waits for locale, slots, and the settings scope before registering its contributions', async () => {
  const { components, locale, slots, plugin } = loadClientUi({ activate: false })
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'configForms'])

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
    await Promise.resolve()
    assert.equal(components.size, 0)

    ctx.provide('configForms', { get: () => ({ getSnapshot: () => ({ value: undefined }), subscribe: () => () => {}, set: () => Promise.resolve(), unset: () => Promise.resolve() }) })
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
  // Skipping the shown release is the third dialog action, and its hint names
  // the surface that still offers the update.
  const ignore = view.getByRole('button', { name: '忽略本次版本' })
  assert.ok(view.getByTestId('modal-footer').contains(ignore))
  assert.match(dialog.textContent, /忽略后可在「设置 → 关于 DeepDive」继续更新/)
})

test('skipping the shown release hides the badge and stores the version', async () => {
  const { components, t, ignored } = loadClientUi()
  const UpdateBadge = components.get('settings.update')
  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  fireEvent.click(await view.findByRole('button', { name: '更新' }))
  await view.findByRole('dialog', { name: 'DeepDive 更新' })

  fireEvent.click(view.getByRole('button', { name: '忽略本次版本' }))

  await waitFor(() => assert.equal(view.queryByRole('button', { name: '更新' }), null))
  assert.equal(view.queryByRole('dialog'), null)
  assert.deepEqual(ignored.writes, ['0.2.0'])
})

test('the ignored release stays quiet while a newer release shows the badge', async () => {
  const quiet = loadClientUi({ ignoredVersion: '0.2.0' })
  const quietView = render(React.createElement(quiet.components.get('settings.update'), { wide: true, t: quiet.t }))
  await waitFor(() => assert.ok(quiet.releaseReads() > 0))
  assert.equal(quietView.queryByRole('button', { name: '更新' }), null)
  cleanup()

  const newer = loadClientUi({ ignoredVersion: '0.2.0', releaseVersion: '0.3.0' })
  const newerView = render(React.createElement(newer.components.get('settings.update'), { wide: true, t: newer.t }))
  assert.ok(await newerView.findByRole('button', { name: '更新' }))
})

test('macOS brand title moves down without changing the row layout', () => {
  loadClientUi()
  const style = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-desktop-client-ui/about.module.css"]')
  assert.ok(style)
  assert.match(style.textContent, /\[data-slot=\"sidebar\.brand\.mark\"\]>\*,\[data-slot=\"sidebar\.brand\.name\"\]>\*\{position:relative;top:4px\}/)
})

test('Windows keeps the upstream brand position', () => {
  loadClientUi({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  const style = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-desktop-client-ui/about.module.css"]')
  assert.ok(style)
  assert.doesNotMatch(style.textContent, /sidebar\.brand\.(?:mark|name)/)
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

test('the About section installs the dsh command and reports where it landed', async () => {
  const calls = []
  const state = {
    path: '/home/user/.local/bin/dsh',
    installed: false,
    present: false,
    onPath: true,
  }
  const cli = {
    status: async () => ({ ...state }),
    install: async () => { calls.push('install'); return { ...state, installed: true, present: true } },
    remove: async () => { calls.push('remove'); return { ...state } },
  }
  const { components, t } = loadClientUi({ cli })
  const AboutSection = components.get('settings.section')

  const view = render(React.createElement(AboutSection, { t }))
  // "Not installed" is also the pre-report label, so the click waits for the
  // report that enables the button rather than that label.
  await waitFor(() => { assert.equal(view.getByRole('button', { name: '安装' }).disabled, false) })
  fireEvent.click(view.getByRole('button', { name: '安装' }))
  await waitFor(() => { assert.deepEqual(calls, ['install']) })
  await view.findByRole('button', { name: '移除' })
  // The installed state names the launcher the shell wrote.
  assert.ok(view.getByText(text => text.includes('/home/user/.local/bin/dsh')))
})

test('an installation outside PATH says so instead of claiming success', async () => {
  const cli = {
    status: async () => ({ path: '/opt/deepdive/dsh', installed: true, present: true, onPath: false }),
    install: async () => ({ path: '/opt/deepdive/dsh', installed: true, present: true, onPath: false }),
    remove: async () => ({ path: '/opt/deepdive/dsh', installed: true, present: true, onPath: false }),
  }
  const { components, t } = loadClientUi({ cli })
  const AboutSection = components.get('settings.section')
  const view = render(React.createElement(AboutSection, { t }))
  await view.findByText('已安装')
  assert.ok(view.getByText('/opt/deepdive/dsh（所在目录不在 PATH 中）'))
})

test('a shell without the command bridge renders no command row', async () => {
  const { components, t } = loadClientUi()
  const AboutSection = components.get('settings.section')
  const view = render(React.createElement(AboutSection, { t }))
  await view.findByText('0.1.6')
  assert.equal(view.queryByRole('button', { name: '安装' }), null)
  assert.equal(view.queryByText('命令行工具 dsh'), null)
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

test('a shell that knows no newer release leaves the badge hidden', async () => {
  const { components, t } = loadClientUi({ releaseAvailable: false })
  const UpdateBadge = components.get('settings.update')
  const view = render(React.createElement(UpdateBadge, { wide: true, t }))
  await waitFor(() => assert.equal(view.queryByRole('button', { name: '更新' }), null))
})

test('a release the shell serialises as null offers no update', async () => {
  const { components, t } = loadClientUi({ releaseAvailable: false, absentLatest: 'null' })
  const UpdateBadge = components.get('settings.update')
  const badge = render(React.createElement(UpdateBadge, { wide: true, t }))
  await waitFor(() => assert.equal(badge.queryByRole('button', { name: '更新' }), null))
  await waitFor(() => assert.equal(badge.queryByRole('dialog'), null))
  cleanup()

  const AboutSection = components.get('settings.section')
  const about = render(React.createElement(AboutSection, { t }))
  await about.findByText('0.1.6')
  fireEvent.click(about.getByRole('button', { name: '检查更新' }))
  await about.findByText('已是最新版本（v0.1.6）')
  assert.equal(about.queryByText(/^v\?$/), null)
  assert.equal(about.queryByRole('dialog'), null)
})

test('a manual check the shell cannot complete reports the failure', async () => {
  const { components, t } = loadClientUi({ releaseUnreachable: true })
  const AboutSection = components.get('settings.section')
  const view = render(React.createElement(AboutSection, { t }))
  await view.findByText('0.1.6')

  fireEvent.click(view.getByRole('button', { name: '检查更新' }))

  await view.findByText('检查更新失败（网络不可用）')
  assert.equal(view.queryByRole('button', { name: '查看更新' }), null)
})

test('a manual check naming no newer release reports the current version', async () => {
  const { components, t } = loadClientUi({ releaseAvailable: false })
  const AboutSection = components.get('settings.section')
  const view = render(React.createElement(AboutSection, { t }))
  await view.findByText('0.1.6')

  fireEvent.click(view.getByRole('button', { name: '检查更新' }))

  await view.findByText('已是最新版本（v0.1.6）')
  assert.equal(view.queryByRole('button', { name: '查看更新' }), null)
})

/**
 * Names the checked-in Desktop client bundle destructures from the shared
 * primitives module table.
 * @returns the required export names, in source order.
 */
function requiredPrimitives() {
  const names = [...clientSource.matchAll(
    /const\s*\{([^}]*)\}\s*=\s*require\("@deepseek-ai\/dsh-client-ui-primitives"\)/g,
  )].flatMap(match => match[1].split(',').map(part => part.trim()).filter(part => part !== ''))
  assert.ok(names.length > 0, 'the Desktop client bundle must destructure the primitives module')
  return names
}

/**
 * Value exports reachable from the primitives package entry in the source
 * plane, following `export *` one module deep (the icon barrel).
 * @returns every exported value name.
 */
function primitivesExportSurface() {
  const names = new Set()
  const collect = (path) => {
    const source = readFileSync(
      new URL(`../../packages/client/ui-primitives/src/${path}`, import.meta.url), 'utf8')
    for (const match of source.matchAll(/^export\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/gm)) {
      names.add(match[1])
    }
    for (const match of source.matchAll(/^export\s+\*\s+from\s+'([^']+)'/gm)) {
      collect(match[1].replace(/^\.\//, ''))
    }
    for (const match of source.matchAll(/^export\s+(?!type\b)\{([^}]*)\}\s*from\s+'[^']+'/gm)) {
      for (const part of match[1].split(',')) {
        const trimmed = part.trim()
        if (trimmed === '' || trimmed.startsWith('type ')) continue
        const name = trimmed.split(/\s+as\s+/).at(-1)
        if (name !== undefined && name !== '') names.add(name)
      }
    }
  }
  collect('index.ts')
  return names
}

// A shared-library rename reaches this bundle only as `undefined` at require
// time, which React reports as an invalid element type when the update dialog
// first renders. Guard the required names against the primitives source so the
// rename fails here instead of inside the shipped dialog.
test('the Desktop client bundle requires only names the primitives package exports', () => {
  const exported = primitivesExportSurface()
  assert.deepEqual(requiredPrimitives().filter(name => !exported.has(name)), [])
})

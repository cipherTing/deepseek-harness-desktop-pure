// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { ElectronWebViewImpl } from '../src/client/electron/ElectronWebViewImpl.ts'
import { ElectronWebviewPresentation } from '../src/client/electron/ElectronWebviewPresentation.ts'
import type { DesktopBrowserBridge, DesktopBrowserEvent, DesktopBrowserGuestState } from '../src/types.ts'

it('notifies DOM focus owners without moving document focus', () => {
  const presentation = new ElectronWebviewPresentation({ mounted: vi.fn(), unmounted: vi.fn(), diagnostic: vi.fn() })
  const host = document.createElement('div')
  host.id = 'native-browser-focus'
  document.body.append(host)
  const activeElement = document.activeElement
  const focus = vi.fn()
  host.addEventListener('focus', focus, true)
  try {
    presentation.mount(host.id)
    const anchor = presentation.createElement({ lease: 'focused-guest' as never, partition: 'workspace' })
    presentation.present(anchor)
    presentation.dispatchGuestFocus()
    expect(focus).toHaveBeenCalledOnce()
    expect(focus.mock.calls[0]![0]).toMatchObject({
      type: 'focus', target: anchor, bubbles: false, composed: true,
    })
    expect(document.activeElement).toBe(activeElement)
    expect(anchor.getAttribute('name')).toBe('focused-guest')
    expect(anchor.dataset.sidebarBrowserAnchor).toBe('true')
    expect(anchor.dataset.sidebarBrowserFrame).toBe('webview')
    expect(anchor.hasAttribute('tabindex')).toBe(false)
  } finally {
    presentation.dispose()
    host.remove()
  }
})

it('clears a failed load when the main page retries without a toolbar command', async () => {
  // Mutable fixture state: the protocol type is read-only because a host never
  // edits state a page is reading.
  const state: { -readonly [K in keyof DesktopBrowserGuestState]: DesktopBrowserGuestState[K] } = {
    url: 'about:blank', title: '', loading: true, canGoBack: false, canGoForward: false,
  }
  const listeners = new Set<(event: DesktopBrowserEvent) => void>()
  const bridge: DesktopBrowserBridge = {
    acquire: vi.fn(async () => ({ lease: 'lease' as never, partition: 'partition' })),
    release: vi.fn(async () => {}),
    onOpenRequested: () => () => {},
    navigate: vi.fn(async () => {}),
    command: vi.fn(async () => {}),
    state: vi.fn(async () => ({ ...state })),
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    reportMeasurement: vi.fn(async () => {}),
    place: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
  }
  const emit = (kind: Exclude<DesktopBrowserEvent['kind'], 'load-failed'>): void => {
    for (const listener of [...listeners]) listener({ lease: 'lease' as never, kind, state: { ...state } })
  }
  const presentation = new ElectronWebviewPresentation({ mounted: () => { frame.attach() }, unmounted: () => { frame.detach() },
    diagnostic: vi.fn() })
  const frame = new ElectronWebViewImpl({ initial: undefined, persist: vi.fn(), openRequested: vi.fn() },
    bridge, async () => 'cwd:/workspace', presentation)
  const host = document.createElement('div')
  host.id = 'electron-frame-retry'
  document.body.append(host)
  try {
    presentation.mount(host.id)
    frame.loadUrl({ kind: 'https', url: 'https://example.test/', title: 'Example' })
    await vi.waitFor(() => { expect(host.firstElementChild).not.toBeNull() })
    state.url = 'https://example.test/'
    state.title = 'Recovered'
    emit('navigated')
    expect(frame.getSnapshot()).toMatchObject({
      address: 'observed', target: { url: 'https://example.test/', title: 'Recovered' },
    })
    state.loading = false
    emit('load-finished')
    expect(frame.getSnapshot()).toMatchObject({ error: undefined, loading: false })
  } finally {
    await frame.dispose()
    host.remove()
  }
})

it('keeps the requested address authoritative until the host reports a real one', async () => {
  const acquire = vi.fn(async (_workspace: string, _initialUrl: string) => ({
    lease: 'lease' as never, partition: 'partition',
  }))
  const navigate = vi.fn(async () => {})
  const bridge: DesktopBrowserBridge = {
    acquire,
    release: vi.fn(async () => {}),
    onOpenRequested: () => () => {},
    navigate,
    command: vi.fn(async () => {}),
    state: vi.fn(async () => ({ url: '', title: '', loading: true, canGoBack: false, canGoForward: false })),
    onEvent: () => () => {},
    reportMeasurement: vi.fn(async () => {}),
    place: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
  }
  const presentation = new ElectronWebviewPresentation({ mounted: () => { frame.attach() }, unmounted: () => { frame.detach() },
    diagnostic: vi.fn() })
  const frame = new ElectronWebViewImpl({ initial: undefined, persist: vi.fn(), openRequested: vi.fn() },
    bridge, async () => 'cwd:/workspace', presentation)
  const host = document.createElement('div')
  host.id = 'electron-frame-blank'
  document.body.append(host)
  try {
    presentation.mount(host.id)
    frame.loadUrl({ kind: 'https', url: 'https://example.test/', title: 'Example' })
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('cwd:/workspace', 'https://example.test/')
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(frame.getSnapshot()).toMatchObject({ address: 'requested', target: { url: 'https://example.test/' } })
  } finally {
    await frame.dispose()
    host.remove()
  }
})

// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { ElectronWebViewImpl } from '../src/client/electron/ElectronWebViewImpl.ts'
import { ElectronWebviewPresentation } from '../src/client/electron/ElectronWebviewPresentation.ts'
import type { DesktopBrowserBridge, DesktopBrowserEvent, DesktopBrowserGuestState } from '../src/types.ts'

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
    place: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
  }
  const emit = (kind: DesktopBrowserEvent['kind']): void => {
    for (const listener of [...listeners]) listener({ lease: 'lease' as never, kind, state: { ...state } })
  }
  const presentation = new ElectronWebviewPresentation({ mounted: () => { frame.attach() }, unmounted: () => { frame.detach() } })
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
  const navigate = vi.fn(async () => {})
  const bridge: DesktopBrowserBridge = {
    acquire: vi.fn(async () => ({ lease: 'lease' as never, partition: 'partition' })),
    release: vi.fn(async () => {}),
    onOpenRequested: () => () => {},
    navigate,
    command: vi.fn(async () => {}),
    state: vi.fn(async () => ({ url: '', title: '', loading: true, canGoBack: false, canGoForward: false })),
    onEvent: () => () => {},
    place: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
  }
  const presentation = new ElectronWebviewPresentation({ mounted: () => { frame.attach() }, unmounted: () => { frame.detach() } })
  const frame = new ElectronWebViewImpl({ initial: undefined, persist: vi.fn(), openRequested: vi.fn() },
    bridge, async () => 'cwd:/workspace', presentation)
  const host = document.createElement('div')
  host.id = 'electron-frame-blank'
  document.body.append(host)
  try {
    presentation.mount(host.id)
    frame.loadUrl({ kind: 'https', url: 'https://example.test/', title: 'Example' })
    await vi.waitFor(() => { expect(navigate).toHaveBeenCalledOnce() })
    expect(frame.getSnapshot()).toMatchObject({ address: 'requested', target: { url: 'https://example.test/' } })
  } finally {
    await frame.dispose()
    host.remove()
  }
})

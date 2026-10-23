/** Native host operations controlled by each test; presentation and navigation stay real. */
import { vi } from 'vitest'
import type {
  DesktopBrowserBridge, DesktopBrowserEvent, DesktopBrowserGuestState, DesktopBrowserLeaseId,
  DesktopBrowserLoadFailure, DesktopBrowserRect, DesktopBrowserReservation,
} from '../src/types.ts'
import type { BrowserTabState } from '../src/client/browser/BrowserPersistence.ts'
import { createElectronPage } from '../src/client/electron/pages.ts'
import { ElectronWebviewPresentation } from '../src/client/electron/ElectronWebviewPresentation.ts'

let sequence = 0

/** The host state a test starts from: a blank guest that has not loaded anything. */
function idleState(): DesktopBrowserGuestState {
  return { url: '', title: '', loading: true, canGoBack: false, canGoForward: false }
}

/** @returns one isolated, explicitly mounted page with host operations replaced by spies. */
export function electronFixture(initial?: BrowserTabState) {
  const opens = new Set<(url: string) => void>()
  const listeners = new Set<(event: DesktopBrowserEvent) => void>()
  const reservation: DesktopBrowserReservation = {
    lease: `lease-${++sequence}` as DesktopBrowserLeaseId,
    partition: 'partition',
  }
  // The guest state a test mutates between notifications; the protocol type is
  // read-only because a host never edits state a page is reading.
  const hostState: { -readonly [K in keyof DesktopBrowserGuestState]: DesktopBrowserGuestState[K] } = {
    ...idleState(),
  }
  const bridge = {
    acquire: vi.fn(async (_workspace: string, _initialUrl: string) => reservation),
    release: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    onOpenRequested: vi.fn((_lease: DesktopBrowserLeaseId, listener: (url: string) => void) => {
      opens.add(listener)
      return () => { opens.delete(listener) }
    }),
    navigate: vi.fn(async (_lease: DesktopBrowserLeaseId, _url: string) => {}),
    command: vi.fn(async (_lease: DesktopBrowserLeaseId, _command: 'reload' | 'back' | 'forward') => {}),
    state: vi.fn(async (_lease: DesktopBrowserLeaseId) => ({ ...hostState })),
    onEvent: vi.fn((listener: (event: DesktopBrowserEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    reportMeasurement: vi.fn(async (_message: string) => {}),
    place: vi.fn(async (_lease: DesktopBrowserLeaseId, _rect: DesktopBrowserRect, _visible: boolean) => {}),
    setVisible: vi.fn(async (_lease: DesktopBrowserLeaseId, _visible: boolean) => {}),
  } satisfies DesktopBrowserBridge
  const workspace = vi.fn(async (_signal: AbortSignal) => 'cwd:/workspace')
  const persist = vi.fn()
  const openRequested = vi.fn()
  const page = createElectronPage({ initial, persist, openRequested }, bridge, workspace)
  const presentation = page.presentation
  if (!(presentation instanceof ElectronWebviewPresentation)) throw new Error('expected the Desktop presentation')
  const createElement = presentation.createElement.bind(presentation)
  const anchors: ReturnType<typeof createElement>[] = []
  vi.spyOn(presentation, 'createElement').mockImplementation((approved) => {
    const anchor = createElement(approved)
    anchors.push(anchor)
    return anchor
  })
  const host = document.createElement('div')
  host.id = `electron-fixture-${sequence}`
  document.body.append(host)
  return {
    ...page, presentation, bridge, workspace, persist, openRequested, opens, anchors, host, reservation, hostState,
    mount: () => presentation.mount(host.id),
    /** Publish one host notification whose payload is the current `hostState`. */
    emit: (kind: Exclude<DesktopBrowserEvent['kind'], 'load-failed'>) => {
      for (const listener of [...listeners]) listener({ lease: reservation.lease, kind, state: { ...hostState } })
    },
    emitLoadFailed: (error: DesktopBrowserLoadFailure) => {
      const state = { ...hostState, error }
      for (const listener of [...listeners]) {
        listener({ lease: reservation.lease, kind: 'load-failed', state, error })
      }
    },
    /** Give the current anchor a fixed box, so measurements are deterministic. */
    moveAnchor: (box: { x: number; y: number; width: number; height: number }) => {
      const anchor = anchors.at(-1)
      if (anchor === undefined) throw new Error('guest has not attached')
      anchor.getBoundingClientRect = () => ({
        ...box, top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height,
        toJSON: () => box,
      })
    },
    async anchor() {
      await vi.waitFor(() => { expectAnchor() })
      return anchors.at(-1)!
    },
    async dispose() {
      await page.frame.dispose()
      vi.restoreAllMocks()
      host.remove()
    },
  }
  function expectAnchor(): void {
    if (host.firstElementChild === null || anchors.length === 0) throw new Error('guest has not attached')
  }
}

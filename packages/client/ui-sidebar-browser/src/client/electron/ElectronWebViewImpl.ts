/** Desktop guest navigation and lifetime, independent from DOM placement. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  DesktopBrowserBridge, DesktopBrowserEvent, DesktopBrowserGuestState, DesktopBrowserLeaseId, DesktopBrowserRect,
} from '../../types.ts'
import type { AnchorBounds, ElectronWebviewPresentation, GuestAnchor } from './ElectronWebviewPresentation.ts'
import { emptyBrowserFrame, type BrowserFrame, type BrowserFrameState, type BrowserLoadError } from '../browser/BrowserFrame.ts'
import type { BrowserPageOptions } from '../browser/BrowserPage.ts'
import { browserAddressCheckpoint, currentBrowserTarget } from '../browser/BrowserPersistence.ts'
import { parseBrowserAddress, type BrowserTarget } from '../browser/url.ts'

/** Host errors that mean the user replaced the navigation, not that it failed. */
const CANCELLED_ERRORS = ['ERR_ABORTED', 'Load request cancelled', 'NSURLErrorCancelled']

/** Cached guest state before the host has reported anything. */
const UNOBSERVED: DesktopBrowserGuestState = {
  url: '', title: '', loading: true, canGoBack: false, canGoForward: false,
}

/** Whether a host navigation rejection is the user's own replacement of it. */
function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return CANCELLED_ERRORS.some(name => message.includes(name))
}

/**
 * Owns native history and translates host observations into common frame state.
 *
 * Every gate reads a cached snapshot rather than awaiting the host: Back,
 * Forward, Reload and address submission decide synchronously whether they may
 * run, so the cache is the frame's only state source and host events refresh it.
 */
export class ElectronWebViewImpl implements BrowserFrame {
  private readonly store: SnapshotStore<BrowserFrameState>
  private readonly lifetime = new AbortController()
  private guestLifetime: AbortController | undefined
  private anchor: GuestAnchor | undefined
  private lease: DesktopBrowserLeaseId | undefined
  private workspaceKey: string | undefined
  private initializing: Promise<void> | undefined
  private ready = false
  private pending: BrowserTarget | undefined
  private revision = 0
  private firstDocument = true
  private checkpoint: BrowserTarget | undefined
  private disposal: Promise<void> | undefined
  private attachment: AbortController | undefined
  private stopFollowing: (() => void) | undefined
  private placement: Promise<void> = Promise.resolve()
  private placementPending: DesktopBrowserRect | undefined
  private readonly releases = new Set<Promise<void>>()
  /** Last state the host reported for this guest, read synchronously by every gate. */
  private observed: DesktopBrowserGuestState = UNOBSERVED

  /**
   * @param options - saved address, persistence and source-tab opening callback.
   * @param bridge - shell-owned guest operations.
   * @param workspace - resolves the storage account once for this frame lifetime.
   * @param presentation - anchor and Sidebar placement adapter.
   */
  constructor(private readonly options: BrowserPageOptions, private readonly bridge: DesktopBrowserBridge,
    private readonly workspace: (signal: AbortSignal) => Promise<string>,
    private readonly presentation: ElectronWebviewPresentation) {
    this.checkpoint = currentBrowserTarget(options.initial)
    this.store = createSnapshotStore(emptyBrowserFrame())
  }

  /** @returns immutable carrier-neutral navigation state. */
  getSnapshot = (): BrowserFrameState => this.store.getSnapshot()
  /** @param listener - state invalidation. @returns unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** A physical mount may recreate a lost guest; ordinary Sidebar hiding never calls this. */
  attach(): void {
    if (this.lifetime.signal.aborted) return
    this.attachment = new AbortController()
    this.pending ??= this.store.getSnapshot().target
    if (this.pending !== undefined) {
      this.store.set({ ...this.store.getSnapshot(), address: 'requested', loading: true,
        canGoBack: false, canGoForward: false, error: undefined })
      this.initialize()
    }
  }

  /** Invalidate pending attachment before the containing DOM is removed. */
  detach(): void {
    this.attachment?.abort()
    this.attachment = undefined
    this.pending = this.store.getSnapshot().target
    void this.dropGuest()
  }

  /** @param target - validated address, loaded without replacing the guest. */
  loadUrl(target: BrowserTarget): void {
    if (this.lifetime.signal.aborted) return
    const current = this.store.getSnapshot()
    if (this.ready && current.address === 'observed' && current.target?.url === target.url) {
      this.reload()
      return
    }
    this.revision++
    this.pending = target
    this.store.set({ ...current, target, address: 'requested', loading: true, error: undefined })
    this.persist(target)
    if (this.ready) this.loadPending()
    else this.initialize()
  }

  /** Move backward when the host reports an available history entry. */
  goBack(): void {
    if (this.store.getSnapshot().canGoBack) this.command('back')
  }

  /** Move forward when the host reports an available history entry. */
  goForward(): void {
    if (this.store.getSnapshot().canGoForward) this.command('forward')
  }

  /** Reload the actual current page, or retry failed guest creation. */
  reload(): void {
    const current = this.store.getSnapshot()
    if (this.lifetime.signal.aborted || current.target === undefined) return
    if (!this.ready || current.error !== undefined) {
      this.revision++
      this.pending = current.target
      this.store.set({ ...current, loading: true, error: undefined })
      if (this.ready) this.loadPending()
      else this.initialize()
    } else this.command('reload')
  }

  /** @returns after pending initialization and the owned guest have been released. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.lifetime.abort()
    this.pending = undefined
    this.disposal = Promise.all([this.dropGuest(), this.initializing])
      .then(() => Promise.all(this.releases)).then(() => {})
    this.presentation.dispose()
    return this.disposal
  }

  private command(operation: 'reload' | 'back' | 'forward'): void {
    const lease = this.lease
    if (this.lifetime.signal.aborted || !this.ready || lease === undefined) return
    this.revision++
    this.pending = undefined
    this.store.set({ ...this.store.getSnapshot(), loading: true, error: undefined })
    void this.bridge.command(lease, operation).catch((error: unknown) => {
      if (!this.lifetime.signal.aborted) this.commandFailed(error)
    })
  }

  private initialize(): void {
    const attachment = this.attachment
    if (attachment === undefined || this.initializing !== undefined || this.anchor !== undefined || this.lifetime.signal.aborted) return
    const signal = AbortSignal.any([this.lifetime.signal, attachment.signal])
    this.initializing = this.createGuest(signal).catch(async (error: unknown) => {
      await this.dropGuest()
      if (!signal.aborted) this.commandFailed(error)
    }).finally(() => {
      this.initializing = undefined
      if (this.attachment !== attachment && this.pending !== undefined) this.initialize()
    })
  }

  private async createGuest(attachmentSignal: AbortSignal): Promise<void> {
    this.workspaceKey ??= await this.workspace(attachmentSignal)
    if (attachmentSignal.aborted) return
    const reservation = await this.bridge.acquire(this.workspaceKey)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- The signal can abort while acquire is pending.
    if (attachmentSignal.aborted) { await this.release(reservation.lease); return }
    this.lease = reservation.lease
    this.guestLifetime = new AbortController()
    const signal = AbortSignal.any([attachmentSignal, this.guestLifetime.signal])
    const anchor = this.presentation.createElement(reservation)
    this.anchor = anchor
    const unsubscribeOpen = this.bridge.onOpenRequested(reservation.lease, (url) => {
      if (this.anchor === anchor && !signal.aborted) this.options.openRequested(url)
    })
    signal.addEventListener('abort', unsubscribeOpen, { once: true })
    const unsubscribeEvents = this.bridge.onEvent((event) => {
      if (this.lease !== reservation.lease || signal.aborted) return
      this.receive(event)
    })
    signal.addEventListener('abort', unsubscribeEvents, { once: true })
    this.presentation.present(anchor)
    this.stopFollowing = this.presentation.follow((bounds) => { this.follow(reservation.lease, bounds) })
    signal.addEventListener('abort', () => {
      this.stopFollowing?.()
      this.stopFollowing = undefined
      // The guest leaves with the attachment; hiding is what the shell needs
      // when the frame itself outlives this presentation.
      void this.bridge.setVisible(reservation.lease, false).catch((error: unknown) => {
        console.error('Desktop browser visibility failed', error)
      })
    }, { once: true })
    // The guest starts blank, so the first document commit is the bootstrap
    // document rather than a user navigation.
    this.ready = true
    this.firstDocument = true
    await this.refresh()
    this.loadPending()
  }

  private loadPending(): void {
    const target = this.pending
    const lease = this.lease
    if (!this.ready || target === undefined || lease === undefined) return
    const revision = this.revision
    this.pending = undefined
    void this.bridge.navigate(lease, target.url).catch((error: unknown) => {
      if (this.lease !== lease || this.lifetime.signal.aborted || this.revision !== revision) return
      if (isCancellation(error)) return
      if (this.store.getSnapshot().error === undefined) this.commandFailed(error)
    })
  }

  /** Apply one host notification to the cached state, then republish frame state. */
  private receive(event: DesktopBrowserEvent): void {
    if (this.lifetime.signal.aborted || event.lease !== this.lease) return
    this.observed = event.state
    const committed = event.kind === 'navigated' || event.kind === 'load-finished'
      || (event.kind === 'title' && this.store.getSnapshot().address === 'observed')
    try { this.observe(committed) }
    catch (error) { this.commandFailed(error) }
  }

  /** Re-read the host's cached state once, then publish it as an observation. */
  private async refresh(): Promise<void> {
    const lease = this.lease
    if (lease === undefined) return
    try {
      this.observed = await this.bridge.state(lease)
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.commandFailed(error)
      return
    }
    if (this.lease !== lease || this.lifetime.signal.aborted) return
    this.observe(this.store.getSnapshot().address !== 'requested')
  }

  /** Synchronous projection of the cached host state into frame state. */
  private observe(committed: boolean): void {
    if (!this.ready || this.anchor === undefined || this.lifetime.signal.aborted) return
    const current = this.store.getSnapshot()
    // A blank or unreadable address is not an observation: the requested
    // address stays authoritative until the guest reports a real one.
    const parsed = committed && this.observed.url !== '' ? parseBrowserAddress(this.observed.url) : undefined
    if (parsed?.ok && this.firstDocument) {
      // The lease-bearing bootstrap document is not a user history entry.
      this.firstDocument = false
    }
    let target = current.target
    let address = current.address
    if (parsed?.ok) {
      target = { ...parsed.target, title: this.observed.title || parsed.target.title }
      address = 'observed'
      this.presentation.show(target.title)
    }
    const loading = current.error === undefined && this.observed.loading
    const canGoBack = this.observed.canGoBack
    const canGoForward = this.observed.canGoForward
    if (target?.url !== current.target?.url || target?.title !== current.target?.title || address !== current.address
      || loading !== current.loading || canGoBack !== current.canGoBack || canGoForward !== current.canGoForward) {
      this.store.set({ ...current, target, address, loading, canGoBack, canGoForward })
    }
    if (parsed?.ok && target !== undefined) this.persist(target)
  }

  /**
   * Move the guest over the anchor, coalescing placements that arrive while
   * one is in flight so a drag cannot queue one command per frame.
   * @param lease - the guest this frame owns.
   * @param bounds - the anchor's current box, or `undefined` while off screen.
   */
  private follow(lease: DesktopBrowserLeaseId, bounds: AnchorBounds | undefined): void {
    if (this.lifetime.signal.aborted || lease !== this.lease) return
    if (bounds === undefined) {
      void this.bridge.setVisible(lease, false).catch((error: unknown) => {
        console.error('Desktop browser visibility failed', error)
      })
      return
    }
    this.placementPending = bounds
    this.placement = this.placement.then(async () => {
      const next = this.placementPending
      this.placementPending = undefined
      if (next === undefined || this.lease !== lease || this.lifetime.signal.aborted) return
      try {
        await this.bridge.place(lease, next, true)
      } catch (error) {
        console.error('Desktop browser placement failed', error)
      }
    })
  }

  private persist(target: BrowserTarget): void {
    if (target.url === this.checkpoint?.url && target.title === this.checkpoint.title) return
    this.checkpoint = target
    this.options.persist(browserAddressCheckpoint(target, this.revision))
  }

  private failed(error: BrowserLoadError = { code: undefined, description: undefined }): void {
    if (this.lifetime.signal.aborted) return
    const current = this.store.getSnapshot()
    this.store.set({ ...current, loading: false, error,
      canGoBack: this.ready && current.canGoBack, canGoForward: this.ready && current.canGoForward })
  }

  private commandFailed(error: unknown): void {
    console.error('Desktop browser operation failed', error)
    this.failed()
  }

  private dropGuest(): Promise<void> {
    this.guestLifetime?.abort()
    this.guestLifetime = undefined
    this.stopFollowing?.()
    this.stopFollowing = undefined
    this.presentation.clear()
    this.anchor = undefined
    this.ready = false
    this.firstDocument = true
    this.observed = UNOBSERVED
    const lease = this.lease
    this.lease = undefined
    return lease === undefined ? Promise.resolve() : this.release(lease)
  }

  private release(lease: DesktopBrowserLeaseId): Promise<void> {
    const released = this.bridge.release(lease)
      .catch((error: unknown) => { console.error('Desktop browser guest release failed', error) })
      .finally(() => { this.releases.delete(released) })
    this.releases.add(released)
    return released
  }
}

/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** What the host last observed for one guest, read synchronously by the frame state. */
export interface DesktopBrowserGuestState {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** One guest lifecycle or navigation notification, addressed by lease. */
export interface DesktopBrowserEvent {
  readonly lease: DesktopBrowserLeaseId
  readonly kind: 'load-started' | 'load-finished' | 'navigated' | 'title'
  /** The host's cached state at this notification, so no reader has to await it. */
  readonly state: DesktopBrowserGuestState
}

/** A guest's address in CSS pixels relative to the main window client area. */
export interface DesktopBrowserRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One history operation the host performs inside the guest page. */
export type DesktopBrowserCommand = 'reload' | 'back' | 'forward'

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /** @param workspace - resolved storage account. @returns one approved guest reservation. */
  acquire(workspace: string): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
  /** @param url - absolute HTTP(S) address. @returns after the guest starts loading it. */
  navigate(lease: DesktopBrowserLeaseId, url: string): Promise<void>
  /** @param command - one history or reload operation. @returns after the guest accepts it. */
  command(lease: DesktopBrowserLeaseId, command: DesktopBrowserCommand): Promise<void>
  /** @returns the host's cached navigation state, re-read from the live guest. */
  state(lease: DesktopBrowserLeaseId): Promise<DesktopBrowserGuestState>
  /** @param listener - every guest event in this window. @returns unsubscribe callback. */
  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void
  /**
   * @param rect - the address to occupy, in CSS pixels relative to the main client area.
   * @param visible - whether the guest is on screen after moving.
   */
  place(lease: DesktopBrowserLeaseId, rect: DesktopBrowserRect, visible: boolean): Promise<void>
  /** @param visible - whether the guest window is on screen. */
  setVisible(lease: DesktopBrowserLeaseId, visible: boolean): Promise<void>
}

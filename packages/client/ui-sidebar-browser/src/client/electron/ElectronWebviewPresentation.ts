/** Sidebar-owned anchor that a native guest window follows. */
import type { DesktopBrowserReservation } from '../../types.ts'
import type { BrowserPresentation } from '../view/BrowserPresentation.ts'
import css from '../view/Browser.module.css'

/** The anchor element a native guest is glued to. */
export type GuestAnchor = HTMLElement

/**
 * One measurement of the anchor, or `undefined` when the anchor is not on
 * screen. The rectangle is in CSS pixels relative to the document viewport.
 */
export interface AnchorBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Physical attachment notifications; hiding a retained Sidebar body emits neither. */
export interface ElectronPresentationEvents {
  readonly mounted: () => void
  readonly unmounted: () => void
}

/** Minimum change that is worth a native reposition. */
const POSITION_EPSILON = 0.5

/**
 * Owns anchor creation and attachment. The navigation provider measures the
 * anchor and asks the shell to move the guest over it; nothing here creates a
 * guest, and no DOM element hosts the page.
 */
export class ElectronWebviewPresentation implements BrowserPresentation {
  private anchor: GuestAnchor | undefined
  private host: HTMLElement | undefined
  private frame: number | undefined
  private last: AnchorBounds | undefined

  constructor(private readonly events: ElectronPresentationEvents) {}

  /** @param viewportId - committed content container. @returns ends attachment, releasing no guest. */
  mount(viewportId: string): () => void {
    const host = document.getElementById(viewportId)
    if (host === null) throw new Error('Electron presentation: content container is not mounted')
    if (this.host !== undefined) this.events.unmounted()
    this.host = host
    this.events.mounted()
    return () => {
      if (this.host !== host) return
      this.events.unmounted()
      this.host = undefined
    }
  }

  /**
   * Create the detached anchor for an approved guest reservation.
   *
   * The anchor keeps the layout the Web carrier used, so the Browser body is
   * identical in both carriers; only what fills the box differs.
   * @param reservation - main-approved partition and bootstrap lease.
   * @returns a detached anchor carrying the guest's identity for diagnostics.
   */
  createElement(reservation: DesktopBrowserReservation): GuestAnchor {
    const element = document.createElement('div')
    element.className = css.webview as string
    element.dataset.sidebarBrowserAnchor = 'true'
    element.dataset.sidebarBrowserFrame = 'webview'
    element.setAttribute('name', reservation.lease)
    element.setAttribute('partition', reservation.partition)
    return element
  }

  /**
   * Attach a prepared anchor, removing any previous one from the container.
   * @param element - configured anchor.
   * @throws when no content container is mounted.
   */
  present(element: GuestAnchor): void {
    if (this.host === undefined) throw new Error('Electron presentation: cannot attach without a content container')
    this.clear()
    this.anchor = element
    this.host.append(element)
  }

  /**
   * Set the anchor's accessible label.
   * @param title - observed document title.
   */
  show(title: string): void {
    this.anchor?.setAttribute('aria-label', title)
  }

  /** Destroy only the anchor; a replacement may use the same mounted container. */
  clear(): void {
    this.anchor?.remove()
    this.anchor = undefined
    this.stopMeasuring()
  }

  /** Destroy the anchor and release its content container. */
  dispose(): void {
    this.clear()
    this.host = undefined
  }

  /**
   * Follow the anchor until the returned disposer runs.
   *
   * A resize observer cannot see the transitions this must survive: the
   * Sidebar collapses with a transform and a visibility change, and a tab
   * switch removes the anchor from layout without resizing it. Measuring once
   * per animation frame covers every one of those paths with one mechanism,
   * and a change smaller than {@link POSITION_EPSILON} sends nothing.
   * @param listener - receives each new on-screen address, or `undefined` once hidden.
   * @returns disposer stopping measurement.
   */
  follow(listener: (bounds: AnchorBounds | undefined) => void): () => void {
    this.stopMeasuring()
    const measure = (): void => {
      this.frame = requestAnimationFrame(measure)
      const next = this.measure()
      if (next === undefined) {
        if (this.last === undefined) return
        this.last = undefined
        listener(undefined)
        return
      }
      if (this.last !== undefined && sameBounds(this.last, next)) return
      this.last = next
      listener(next)
    }
    this.frame = requestAnimationFrame(measure)
    return () => { this.stopMeasuring() }
  }

  private stopMeasuring(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.last = undefined
  }

  private measure(): AnchorBounds | undefined {
    const anchor = this.anchor
    if (anchor === undefined || this.host === undefined || !anchor.isConnected) return undefined
    // `checkVisibility` reports the `visibility` and `content-visibility`
    // states a collapsed Sidebar uses; the rectangle alone stays non-zero.
    if (typeof anchor.checkVisibility === 'function'
      && !anchor.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return undefined
    const rect = anchor.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return undefined
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }
}

/** Whether two measurements address the same on-screen box. */
function sameBounds(left: AnchorBounds, right: AnchorBounds): boolean {
  return Math.abs(left.x - right.x) < POSITION_EPSILON
    && Math.abs(left.y - right.y) < POSITION_EPSILON
    && Math.abs(left.width - right.width) < POSITION_EPSILON
    && Math.abs(left.height - right.height) < POSITION_EPSILON
}

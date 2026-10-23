import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { installShortcuts } from './shortcuts.ts'

document.documentElement.dataset.dshDesktop = 'true'

/**
 * Desktop bridge (page side): the ONLY frontend coupling the desktop shell
 * needs. The page is served by the real Harness web host over loopback HTTP,
 * so fetch, EventSource and WebSocket are native. Session export uses the
 * generic save carrier installed before the client plugin tree boots.
 */

/**
 * The upstream client branches on `'dshDesktop' in globalThis` to select its
 * Desktop behavior, so this object is the carrier's product API rather than a
 * shim: every member exists because a client plugin reads it.
 */
interface DshDesktop {
  readonly protocolVersion: 1
  /** @returns the local machine description for the feedback questionnaire. */
  readonly deviceInfo: () => Promise<string>
  /** Native carrier for the Sidebar Browser tabs. */
  readonly browser: DesktopBrowserBridge
  /** Device-local shortcut preferences and the input that consumes them. */
  readonly shortcuts: DesktopShortcutsApi
  readonly keyboard: DesktopKeyboardApi
  /** The `dsh` launcher in the user's PATH. */
  readonly cli: DesktopCliApi
  /** The release the shell's feed poll remembers. */
  readonly release: DesktopReleaseApi
}

/** Release facts the shell reports; `latest` is absent when this build is current. */
interface DesktopReleaseReport {
  readonly version: string
  readonly latest?: string
  readonly notes?: string
  readonly page?: string
  /** Installer link per platform key, as the release workflow published them. */
  readonly assets?: Readonly<Record<string, string>>
}

/** The feed state, read from the shell rather than polled by the page. */
interface DesktopReleaseApi {
  state(): Promise<DesktopReleaseReport>
  check(): Promise<DesktopReleaseReport>
}

/** Install state of the `dsh` command the shell wrote. */
interface DesktopCliStatus {
  /** Absolute launcher path this installation owns or would write. */
  readonly path: string
  /** Whether the file at `path` is the one this installation wrote. */
  readonly installed: boolean
  /** Whether any file already occupies `path`. */
  readonly present: boolean
  /** Whether the launcher's directory is on this process's PATH. */
  readonly onPath: boolean
  /** Desktop version that wrote the launcher. */
  readonly version?: string
}

/** Launcher management; every member reports the resulting state. */
interface DesktopCliApi {
  status(): Promise<DesktopCliStatus>
  install(): Promise<DesktopCliStatus>
  remove(): Promise<DesktopCliStatus>
}

/**
 * Onboarding capability. The upstream Electron preload exposes the same two
 * members from its native welcome window; here the page owns the whole
 * onboarding flow, so `setActive` blocks native keyboard input underneath it.
 */
interface DshOnboarding {
  /** @returns whether any configured model route holds a usable credential. */
  readonly hasApiKey: () => Promise<boolean>
  /** @param active - whether the onboarding overlay currently covers the app. */
  readonly setActive: (active: boolean) => void
}

type DesktopSaveResult = 'file-saved' | 'cancelled'

/** Lease-scoped navigation state the guest host caches between events. */
interface DesktopBrowserGuestState {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error?: DesktopBrowserLoadFailure
}

interface DesktopBrowserLoadFailure {
  readonly code?: number
  readonly description?: string
}

/** One guest lifecycle, navigation, focus, or failure notification. */
type DesktopBrowserEvent = {
  readonly lease: string
  readonly state: DesktopBrowserGuestState
} & (
  | {
    readonly kind: 'load-started' | 'load-finished' | 'navigated' | 'history-changed' | 'title' | 'guest-focused'
  }
  | { readonly kind: 'load-failed'; readonly error: DesktopBrowserLoadFailure }
)

type DesktopBrowserWireEvent = DesktopBrowserEvent | {
  readonly lease: string
  readonly kind: 'open-requested'
  readonly state: DesktopBrowserGuestState
  readonly url: string
}

/** Main-approved identity of one guest reservation. */
type DesktopBrowserLeaseId = string & { readonly __brand: 'DesktopBrowserLeaseId' }

interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/**
 * Native Sidebar Browser carrier. The page reports each guest view's bounds;
 * the shell owns the view and its navigation state.
 */
interface DesktopBrowserBridge {
  acquire(workspace: string, initialUrl: string): Promise<DesktopBrowserReservation>
  release(lease: DesktopBrowserLeaseId): Promise<void>
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
  navigate(lease: DesktopBrowserLeaseId, url: string): Promise<void>
  /** @param command - one history or reload operation. */
  command(lease: DesktopBrowserLeaseId, command: 'reload' | 'back' | 'forward'): Promise<void>
  state(lease: DesktopBrowserLeaseId): Promise<DesktopBrowserGuestState>
  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void
  /** @param message - URL-free page measurement status. @returns after it reaches the shell log. */
  reportMeasurement(message: string): Promise<void>
  /**
   * @param lease - guest to move.
   * @param rect - address in CSS pixels relative to the main window client area.
   * @param visible - whether the guest is on screen after moving.
   */
  place(lease: DesktopBrowserLeaseId, rect: { x: number; y: number; width: number; height: number },
    visible: boolean): Promise<void>
  /** @param visible - whether the guest window is on screen. */
  setVisible(lease: DesktopBrowserLeaseId, visible: boolean): Promise<void>
}

interface DownloadCarrier {
  save(url: string, filename: string): Promise<DesktopSaveResult>
}

interface FileHandler {
  readonly id: string
  readonly label: string
}

interface FileHandlerMenu {
  readonly primary: FileHandler | null
  readonly handlers: readonly FileHandler[]
}

type LinkMenuTarget =
  | {
    readonly kind: 'url'
    readonly url: URL
  }
  | {
    readonly kind: 'file'
    readonly path: string
    readonly open: () => void | Promise<void>
  }

interface LinkMenuLabels {
  readonly openExternal: string
  readonly copyLink: string
  readonly openFile: string
  readonly openWith: string
  readonly defaultApplication: string
  openIn(application: string): string
  readonly saveFileAs: string
  readonly copyPath: string
  readonly revealFile: string
}

const MACOS_TITLE_BAR_HEIGHT = 30
/**
 * Top inset the shared layout reserves for the window's own strip. The client
 * declares it only for the Electron host's `data-platform="darwin"`, and
 * Desktop owns the same overlay strip through Tauri, so entry pages that pad by
 * this token would otherwise collide with the traffic lights. Portalled
 * overlays use the separate overlay token with the shared 20px safe inset.
 */
const TITLE_BAR_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'summary',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="textbox"]',
].join(',')

const LINK_MENU_STYLE_ID = 'dsh-desktop-link-menu'

/** Read the Harness locale that the Desktop client plugin keeps in sync. */
function activePageLocale(): string {
  const locale = document.documentElement.dataset.dshDesktopLocale
    || document.documentElement.lang
    || navigator.language
  return locale.toLowerCase()
}

function linkMenuLabels(): LinkMenuLabels {
  const chinese = activePageLocale().startsWith('zh')
  if (chinese) {
    return {
      openExternal: '在外部浏览器中打开',
      copyLink: '复制链接',
      openFile: '使用默认应用打开',
      openWith: '使用其他应用打开',
      defaultApplication: '默认应用',
      openIn: application => `使用 ${application} 打开`,
      saveFileAs: '另存为…',
      copyPath: '复制路径',
      revealFile: navigator.userAgent.includes('Macintosh') ? '在 Finder 中显示' : '在文件资源管理器中显示',
    }
  }
  return {
    openExternal: 'Open in external browser',
    copyLink: 'Copy link',
    openFile: 'Open with default application',
    openWith: 'Open with',
    defaultApplication: 'Default application',
    openIn: application => `Open in ${application}`,
    saveFileAs: 'Save as…',
    copyPath: 'Copy path',
    revealFile: navigator.userAgent.includes('Macintosh') ? 'Reveal in Finder' : 'Show in File Explorer',
  }
}

function linkTargetOf(source: EventTarget | null): LinkMenuTarget | null {
  const element = source instanceof Element
    ? source
    : source instanceof Node
      ? source.parentElement
      : null
  if (element === null) return null
  const anchor = element.closest<HTMLAnchorElement>('a[href]')
  if (anchor !== null) {
    try {
      const url = new URL(anchor.href, window.location.href)
      if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'url', url }
      if (url.protocol === 'file:') {
        return {
          kind: 'file',
          path: url.href,
          open: () => invoke('desktop_open_file', { path: url.href }),
        }
      }
    } catch {
      return null
    }
  }

  const nativeButton = element.closest<HTMLButtonElement>('button[data-dsh-file-path]')
  const nativePath = nativeButton?.dataset.dshFilePath
  if (nativePath !== undefined && nativePath !== '') {
    return {
      kind: 'file',
      path: nativePath,
      open: () => invoke('desktop_open_file', { path: nativePath }),
    }
  }

  const button = element.closest<HTMLButtonElement>('button[title]')
  if (button === null) return null
  const isInlineMention = button.parentElement?.tagName === 'CODE'
  const isProducedFile = button.closest('[data-produced-files-row]') !== null
  if (!isInlineMention && !isProducedFile) return null
  const path = button.title
  if (path === '') return null
  return {
    kind: 'file',
    path,
    open: () => {
      if (canRevealFile(path)) return invoke('desktop_open_file', { path })
      button.click()
    },
  }
}

function canRevealFile(path: string): boolean {
  if (path.startsWith('file:')) return true
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    await invoke('desktop_copy_text', { text })
  }
}

function logLinkActionError(error: unknown): void {
  console.error('[desktop] link action failed:', error)
}

function installLinkMenuStyles(): void {
  if (document.getElementById(LINK_MENU_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = LINK_MENU_STYLE_ID
  style.textContent = [
    '.dsh-desktop-link-menu{position:fixed;z-index:2147483647;min-width:196px;padding:4px;border:1px solid rgba(255,255,255,.22);border-radius:12px;background:#1e1e1f;box-shadow:0 14px 36px rgba(0,0,0,.48);color:#f5f5f7;font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '.dsh-desktop-link-menu button{display:flex;width:100%;min-height:32px;align-items:center;border:0;border-radius:7px;background:transparent;color:inherit;padding:5px 10px;text-align:left;font:inherit;cursor:pointer}',
    '.dsh-desktop-link-menu button:hover,.dsh-desktop-link-menu button:focus-visible{background:#0a5ad9;outline:0}',
    '.dsh-desktop-link-menu [role="separator"]{height:1px;margin:4px 6px;background:rgba(255,255,255,.2)}',
    '.dsh-desktop-link-submenu{position:relative;box-sizing:border-box;width:calc(100% + 8px);margin-left:-4px}',
    '.dsh-desktop-link-menu .dsh-desktop-link-submenu-trigger{box-sizing:border-box;width:calc(100% - 8px);margin:0 4px}',
    '.dsh-desktop-link-submenu-trigger::after{content:"›";margin-left:auto;padding-left:16px;font-size:18px;line-height:1}',
    '.dsh-desktop-link-submenu-menu{display:none;position:absolute;z-index:1;top:-4px;left:100%;min-width:200px;max-width:calc(100vw - 16px);box-sizing:border-box;padding-left:4px}',
    '.dsh-desktop-link-submenu-panel{box-sizing:border-box;min-width:196px;max-width:100%;max-height:min(440px,calc(100vh - 16px));overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:4px;border:1px solid rgba(255,255,255,.22);border-radius:12px;background:#1e1e1f;box-shadow:0 14px 36px rgba(0,0,0,.48)}',
    '.dsh-desktop-link-submenu.is-open>.dsh-desktop-link-submenu-menu{display:block}',
    '.dsh-desktop-link-submenu.opens-left>.dsh-desktop-link-submenu-menu{right:100%;left:auto;padding-right:4px;padding-left:0}',
  ].join('')
  document.head.appendChild(style)
}

function installLinkInteractions(): void {
  let menu: HTMLDivElement | null = null
  let menuGeneration = 0

  const closeMenu = (): void => {
    menuGeneration += 1
    menu?.remove()
    menu = null
  }

  const addAction = (label: string, action: () => void | Promise<void>): HTMLButtonElement => {
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.textContent = label
    item.addEventListener('click', () => {
      closeMenu()
      void Promise.resolve(action()).catch(logLinkActionError)
    })
    return item
  }

  const addSubmenu = (label: string, items: readonly HTMLButtonElement[]): HTMLDivElement => {
    const container = document.createElement('div')
    container.className = 'dsh-desktop-link-submenu'
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'dsh-desktop-link-submenu-trigger'
    trigger.setAttribute('role', 'menuitem')
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.textContent = label
    const submenu = document.createElement('div')
    submenu.className = 'dsh-desktop-link-submenu-menu'
    submenu.setAttribute('role', 'menu')
    const panel = document.createElement('div')
    panel.className = 'dsh-desktop-link-submenu-panel'
    panel.append(...items)
    submenu.append(panel)
    const open = (): void => {
      container.classList.add('is-open')
      container.classList.remove('opens-left')
      submenu.style.top = '-4px'
      const containerBounds = container.getBoundingClientRect()
      const submenuBounds = submenu.getBoundingClientRect()
      const top = Math.max(
        8,
        Math.min(containerBounds.top - 4, window.innerHeight - submenuBounds.height - 8),
      )
      submenu.style.top = `${top - containerBounds.top}px`
      container.classList.toggle('opens-left', submenu.getBoundingClientRect().right > window.innerWidth - 8)
    }
    trigger.addEventListener('pointerenter', open)
    container.addEventListener('pointerleave', () => {
      container.classList.remove('is-open')
    })
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (container.classList.contains('is-open')) {
        container.classList.remove('is-open')
      } else {
        open()
      }
    })
    container.append(trigger, submenu)
    return container
  }

  const separator = (): HTMLDivElement => {
    const line = document.createElement('div')
    line.setAttribute('role', 'separator')
    return line
  }

  const showMenu = async (target: LinkMenuTarget, x: number, y: number): Promise<void> => {
    closeMenu()
    const generation = ++menuGeneration
    const labels = linkMenuLabels()
    const fileHandlers = target.kind === 'file' && canRevealFile(target.path)
      ? await invoke<FileHandlerMenu>('desktop_file_handlers', { path: target.path })
        .catch((error: unknown) => {
          logLinkActionError(error)
          return null
        })
      : null
    if (generation !== menuGeneration) return
    menu = document.createElement('div')
    menu.className = 'dsh-desktop-link-menu'
    menu.setAttribute('role', 'menu')
    menu.tabIndex = -1
    if (target.kind === 'url') {
      menu.append(
        addAction(labels.openExternal, () => invoke('desktop_open_external_url', { url: target.url.href })),
        separator(),
        addAction(labels.copyLink, () => copyText(target.url.href)),
      )
    } else {
      const primary = fileHandlers?.primary
      menu.append(addAction(
        primary === null || primary === undefined ? labels.openFile : labels.openIn(primary.label),
        primary === null || primary === undefined
          ? target.open
          : () => invoke('desktop_open_file_with', { path: target.path, handlerId: primary.id }),
      ))
      if (fileHandlers !== null && fileHandlers.handlers.length > 0) {
        menu.append(addSubmenu(labels.openWith, [
          addAction(labels.defaultApplication, target.open),
          ...fileHandlers.handlers.map(handler => addAction(
            labels.openIn(handler.label),
            () => invoke('desktop_open_file_with', { path: target.path, handlerId: handler.id }),
          )),
        ]))
      }
      menu.append(separator())
      if (canRevealFile(target.path)) {
        menu.append(
          addAction(labels.saveFileAs, () => invoke('desktop_save_file_as', { path: target.path })),
          addAction(labels.copyPath, () => copyText(target.path)),
          addAction(labels.revealFile, () => invoke('desktop_reveal_file', { path: target.path })),
        )
      } else {
        menu.append(
          addAction(labels.copyPath, () => copyText(target.path)),
        )
      }
    }
    document.body.appendChild(menu)
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    menu.focus({ preventScroll: true })
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = linkTargetOf(event.target)
    if (target === null || (target.kind === 'file' && !canRevealFile(target.path))) return
    event.preventDefault()
    event.stopPropagation()
    const action = target.kind === 'url'
      ? invoke('desktop_open_external_url', { url: target.url.href })
      : target.open()
    void Promise.resolve(action).catch(logLinkActionError)
  }, true)
  document.addEventListener('contextmenu', (event) => {
    const target = linkTargetOf(event.target)
    if (target === null) return
    event.preventDefault()
    event.stopPropagation()
    void showMenu(target, event.clientX, event.clientY)
  }, true)
  document.addEventListener('pointerdown', (event) => {
    if (menu !== null && event.target instanceof Node && !menu.contains(event.target)) closeMenu()
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu()
  }, true)
  window.addEventListener('blur', closeMenu)
}

/** Restore native title-bar gestures over the macOS overlay title bar. */
function installMacOSOverlayTitleBar(): void {
  if (!navigator.userAgent.includes('Macintosh')) return
  window.addEventListener('mousedown', (event) => {
    if (event.buttons !== 1 || event.clientY > MACOS_TITLE_BAR_HEIGHT) return
    const target = event.target
    if (target instanceof Element && target.closest(TITLE_BAR_INTERACTIVE_SELECTOR) !== null) return
    event.preventDefault()
    const appWindow = getCurrentWindow()
    const operation = event.detail === 2 ? appWindow.toggleMaximize() : appWindow.startDragging()
    void operation.catch((error: unknown) => {
      console.error('[desktop] title bar gesture failed:', error)
    })
  }, true)
}

const carrier: DownloadCarrier = {
  // The shared carrier hands over a document-relative Host route; the Rust
  // command downloads from the current loopback origin, so resolve it here
  // against the page's own base.
  save: (url, filename) => invoke<DesktopSaveResult>('desktop_save_session', {
    request: {
      method: 'GET',
      url: new URL(url, document.baseURI).toString(),
      headers: {},
    },
    filename,
  }),
}

Object.defineProperty(globalThis, '__DSH_DOWNLOAD_CARRIER__', {
  configurable: true,
  value: Object.freeze(carrier),
})

/**
 * Mirror the window's fullscreen state onto the document root.
 *
 * The shared clearance rules drop the native window strip's inset while the
 * window is fullscreen; only the carrier knows that state, so it publishes it
 * on every transition and once at boot.
 */
function installFullscreenMark(): void {
  const root = document.documentElement
  const sync = (fullscreen: boolean): void => {
    if (fullscreen) root.dataset.fullscreen = 'true'
    else delete root.dataset.fullscreen
  }
  const appWindow = getCurrentWindow()
  void appWindow.isFullscreen().then(sync, (error: unknown) => {
    console.error('[desktop] fullscreen state unavailable:', error)
  })
  void appWindow.onResized(() => {
    void appWindow.isFullscreen().then(sync, () => { /* A read failure keeps the last mark. */ })
  })
}

installMacOSOverlayTitleBar()
installFullscreenMark()
installLinkMenuStyles()
installLinkInteractions()

/**
 * Read the machine description once and cache it: the questionnaire is opened
 * rarely and the answer cannot change while the process runs.
 */
let deviceInfoReading: Promise<string> | undefined

const onboardingApi: DshOnboarding = {
  hasApiKey: () => invoke<boolean>('desktop_credentials_present'),
  setActive: (active) => { shortcutCarrier.setBlocked(active) },
}

/**
 * The guest host emits one event stream for every tab; subscribers are the
 * per-tab bridges, which filter by lease and deliver only their own events.
 */
/**
 * Report one failure to the shell's log file.
 *
 * A packaged WebView has no readable console, so a page-side failure that ends
 * in a closed window or a silent retry leaves nothing to inspect afterwards.
 * @param message - one line describing what failed.
 */
function reportToShellLog(message: string): void {
  void invoke('desktop_log', { message: message.slice(0, 2048) }).catch(() => {})
}

window.addEventListener('error', (event) => {
  const kind = event.error instanceof Error ? event.error.name : 'Error'
  reportToShellLog(`uncaught: ${kind} at line ${event.lineno}`)
})
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  reportToShellLog(`rejection: ${reason instanceof Error ? reason.name : typeof reason}`)
})

/**
 * Run one Shell command, recording its failure before rethrowing it.
 * @param command - Tauri command name.
 * @param payload - command arguments.
 * @returns the command result.
 */
async function traced<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload)
  } catch (error) {
    reportToShellLog(`${command} failed: ${error instanceof Error ? error.name : typeof error}`)
    throw error
  }
}

const browserEventListeners = new Set<(event: DesktopBrowserEvent) => void>()
const browserOpenListeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()

void listen<DesktopBrowserWireEvent>('desktop-browser-event', (event) => {
  if (event.payload.kind === 'open-requested') {
    const listeners = browserOpenListeners.get(event.payload.lease as DesktopBrowserLeaseId)
    for (const listener of [...listeners ?? []]) listener(event.payload.url)
    return
  }
  for (const listener of [...browserEventListeners]) {
    try {
      listener(event.payload)
    } catch (error) {
      console.error('[desktop] browser event handler failed:', error)
    }
  }
})

const browserApi: DesktopBrowserBridge = {
  acquire: (workspace, initialUrl) => traced<DesktopBrowserReservation>('desktop_browser_acquire', { workspace, initialUrl }),
  release: lease => traced<void>('desktop_browser_release', { lease }),
  onOpenRequested: (lease, listener) => {
    const listeners = browserOpenListeners.get(lease) ?? new Set()
    listeners.add(listener)
    browserOpenListeners.set(lease, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) browserOpenListeners.delete(lease)
    }
  },
  navigate: (lease, url) => traced<void>('desktop_browser_navigate', { lease, url }),
  command: (lease, command) => traced<void>('desktop_browser_command', { lease, command }),
  state: lease => traced<DesktopBrowserGuestState>('desktop_browser_state', { lease }),
  onEvent: (listener) => {
    browserEventListeners.add(listener)
    return () => { browserEventListeners.delete(listener) }
  },
  reportMeasurement: message => traced<void>('desktop_log', { message: `browser measure: ${message}` }),
  place: (lease, rect, visible) => traced<void>('desktop_browser_bounds', {
    lease, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible,
  }),
  setVisible: (lease, visible) => traced<void>('desktop_browser_visible', { lease, visible }),
}

const shortcutCarrier = installShortcuts()
// The shared stylesheets and the shortcut defaults both branch on this mark;
// it is written here, ahead of every client module, because a later write would
// leave the first render on the Web rules.
document.documentElement.dataset.platform = shortcutCarrier.mark

const releaseApi: DesktopReleaseApi = {
  state: () => invoke<DesktopReleaseReport>('desktop_release_state'),
  check: () => invoke<DesktopReleaseReport>('desktop_release_check'),
}

const cliApi: DesktopCliApi = {
  status: () => invoke<DesktopCliStatus>('desktop_cli_status'),
  install: () => invoke<DesktopCliStatus>('desktop_cli_install'),
  remove: () => invoke<DesktopCliStatus>('desktop_cli_remove'),
}

const desktopApi: DshDesktop = {
  protocolVersion: 1,
  deviceInfo: () => {
    deviceInfoReading ??= invoke<string>('desktop_device_info')
    return deviceInfoReading
  },
  browser: browserApi,
  shortcuts: shortcutCarrier.shortcuts,
  keyboard: shortcutCarrier.keyboard,
  cli: cliApi,
  release: releaseApi,
}

Object.defineProperty(globalThis, 'dshDesktop', {
  configurable: true,
  value: Object.freeze(desktopApi),
})

Object.defineProperty(globalThis, 'dshOnboarding', {
  configurable: true,
  value: Object.freeze(onboardingApi),
})

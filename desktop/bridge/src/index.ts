import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

document.documentElement.dataset.dshDesktop = 'true'

/**
 * Desktop bridge (page side): the ONLY frontend coupling the desktop shell
 * needs. The page is served by the real Harness web host over loopback HTTP,
 * so fetch, EventSource and WebSocket are native. Session export uses the
 * generic save carrier installed before the client plugin tree boots.
 */

type DesktopSaveResult = 'file-saved' | 'cancelled'

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
  readonly copyFileContents: string
  readonly revealFile: string
}

const MACOS_TITLE_BAR_HEIGHT = 30
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
      copyFileContents: '复制文件内容',
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
    copyFileContents: 'Copy file contents',
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
          addAction(labels.copyFileContents, () => invoke('desktop_copy_file_contents', { path: target.path })),
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
  save: (url, filename) => invoke<DesktopSaveResult>('desktop_save_session', {
    request: {
      method: 'GET',
      url,
      headers: {},
    },
    filename,
  }),
}

Object.defineProperty(globalThis, '__DSH_DOWNLOAD_CARRIER__', {
  configurable: true,
  value: Object.freeze(carrier),
})

installMacOSOverlayTitleBar()
installLinkMenuStyles()
installLinkInteractions()

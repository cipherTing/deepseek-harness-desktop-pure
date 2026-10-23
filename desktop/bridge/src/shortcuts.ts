import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  ShortcutPersistence, bindingKey, effectiveShortcuts, parseShortcutDefinitions, parseShortcutEdit,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {
  DesktopKeyboardApi, DesktopShortcutInput, DesktopShortcutsApi, NormalizedBinding,
  ShortcutConfigSnapshot, ShortcutDefinition, ShortcutPlatform,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'

/**
 * Device-local shortcuts and the keyboard input they consume.
 *
 * The main document matches DOM keys; native interception covers the iframe
 * and Browser guest documents whose key events cannot reach it. Both carriers
 * use the shared effective bindings and accepted configuration revision.
 */

/** Platform names the shared protocol and stylesheets each expect. */
interface DevicePlatform {
  readonly platform: ShortcutPlatform
  /** Document mark: Electron's `process.platform` spelling. */
  readonly mark: string
}

/**
 * Resolve the device platform from the WebView's user agent.
 * @returns the protocol platform and the document mark shared stylesheets read.
 */
function detectPlatform(): DevicePlatform {
  const agent = navigator.userAgent
  if (/Macintosh|Mac OS X/iu.test(agent)) return { platform: 'macos', mark: 'darwin' }
  if (/Windows/iu.test(agent)) return { platform: 'windows', mark: 'win32' }
  throw new Error('DeepDive Desktop supports macOS and Windows only')
}

/** Keys that only change held-key state, never a binding of their own. */
const MODIFIER_KEY = /^(Control|Alt|Shift|Meta)(Left|Right)$/u

/** Which modifier keys one event reports as held. */
function modifiersOf(event: KeyboardEvent): readonly ('control' | 'alt' | 'shift' | 'meta')[] {
  return [
    ...event.ctrlKey ? ['control' as const] : [],
    ...event.altKey ? ['alt' as const] : [],
    ...event.shiftKey ? ['shift' as const] : [],
    ...event.metaKey ? ['meta' as const] : [],
  ]
}

/**
 * Create the shortcut storage adapter and the keyboard input source.
 * @returns the two `dshDesktop` members and the document mark to apply.
 */
export function installShortcuts(): {
  shortcuts: DesktopShortcutsApi
  keyboard: DesktopKeyboardApi
  mark: string
  setBlocked(active: boolean): void
  dispose(): void
} {
  const device = detectPlatform()
  let definitions: readonly ShortcutDefinition[] = []
  let recording = false
  let blocked = false
  let bindings: readonly NormalizedBinding[] = []
  let focus = { kind: 'keyboard' as 'keyboard' | 'iframe', frameName: '' }
  let nativeConfiguration = Promise.resolve()
  let nativeInputReady: Promise<void> = Promise.resolve()
  let disposed = false
  let unlistenNativeInput: (() => void) | undefined
  /** Binding keys the accepted configuration claims, as `bindingKey` strings. */
  let claimed = new Set<string>()
  let snapshot: ShortcutConfigSnapshot | undefined
  const subscribers = new Set<(snapshot: ShortcutConfigSnapshot) => void>()
  const listeners = new Set<(input: DesktopShortcutInput) => void>()
  /** Keys currently down, so a second key can complete a chord. */
  const held = new Set<string>()
  /** Codes one accepted press already consumed; a repeat must not re-fire them. */
  const consumed = new Set<string>()

  /** Serialize native updates so focus and configuration changes cannot overtake one another. */
  const configureNative = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    const configuration = {
      revision: snapshot?.status === 'loading' || definitions.length === 0 ? null : snapshot?.revision ?? null,
      bindings, recording, blocked, focus,
    }
    nativeConfiguration = nativeConfiguration.catch(() => {}).then(async () => {
      await nativeInputReady
      await invoke<void>('desktop_keyboard_configure', { configuration })
    })
    // Focus and catalog notifications have no awaiting caller; API methods
    // still await the same promise and report a failed installation.
    void nativeConfiguration.catch((error: unknown) => {
      console.error('[desktop] native shortcut configuration failed:', error)
    })
    return nativeConfiguration
  }

  /** Read the named trusted iframe after the browser has committed its focus change. */
  const publishFocus = (): void => {
    let target = document.activeElement
    while (target?.shadowRoot?.activeElement != null) target = target.shadowRoot.activeElement
    focusObserver.disconnect()
    focusObserver.observe(document.documentElement, { childList: true, subtree: true })
    const root = target?.getRootNode()
    if (root instanceof ShadowRoot) {
      focusObserver.observe(root, { childList: true, subtree: true })
    }
    const frameName = target?.getAttribute('name') ?? ''
    const next = target?.isConnected === true
      && target.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')
      && frameName !== ''
      ? { kind: 'iframe' as const, frameName }
      : { kind: 'keyboard' as const, frameName: '' }
    if (next.kind === focus.kind && next.frameName === focus.frameName) return
    focus = next
    resetInput()
    void configureNative()
  }
  const scheduleFocus = (): void => { queueMicrotask(publishFocus) }
  const focusObserver = new MutationObserver((records) => {
    if (records.some(record => record.removedNodes.length > 0)) scheduleFocus()
  })
  focusObserver.observe(document.documentElement, { childList: true, subtree: true })

  /**
   * Republish one accepted snapshot and rebuild the claimed-binding index.
   * @param next - snapshot the storage adapter accepted.
   */
  const publish = (next: ShortcutConfigSnapshot): void => {
    snapshot = next
    bindings = next.status === 'loading'
      ? []
      : effectiveShortcuts(definitions, next.document, 'desktop', device.platform)
        .flatMap(row => row.binding !== null && row.issue === null && row.conflicts.length === 0
          ? [row.binding] : [])
    claimed = new Set(bindings.map(bindingKey))
    resetInput()
    void configureNative()
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(next)
      } catch (error) {
        console.error('[desktop] shortcut subscriber failed:', error)
      }
    }
  }

  const persistence = new ShortcutPersistence({
    read: () => invoke<string | null>('desktop_keybindings_read'),
    write: async (raw) => { await invoke<void>('desktop_keybindings_write', { document: raw }) },
  }, 'desktop', device.platform, false, publish)

  /** Forget held keys after a chord, a blur, or a configuration change. */
  const resetInput = (): void => {
    held.clear()
    consumed.clear()
  }

  /**
   * Resolve one press against the claimed-binding index.
   *
   * A single key needs its exact modifier set; with two keys down the sorted
   * pair is checked first, which is how a two-key chord outranks the binding of
   * either key alone.
   * @param event - the document's key event.
   * @returns the binding to dispatch, or `undefined` to let the key through.
   */
  const resolve = (event: KeyboardEvent): NormalizedBinding | undefined => {
    if (snapshot === undefined || recording || blocked) return undefined
    if (event.isComposing || event.getModifierState('AltGraph')) return undefined
    if (MODIFIER_KEY.test(event.code)) {
      held.clear()
      return undefined
    }
    const modifiers = modifiersOf(event)
    const single = claimed.has(bindingKey({ code: event.code, modifiers }))
    // A repeat may only re-fire a key a press already claimed; the first repeat
    // of an unclaimed key is still the user holding it down for the OS.
    if (event.repeat && !single && !consumed.has(event.code)) return undefined
    if (event.repeat && !held.has(event.code) && !single) return undefined
    held.add(event.code)
    const [first, second] = [...held].sort()
    if (first !== undefined && second !== undefined) {
      const chord = { code: first, secondCode: second, modifiers }
      if (claimed.has(bindingKey(chord))) return chord
    }
    return single ? { code: event.code, modifiers } : undefined
  }

  /**
   * Only macOS and Windows route configurable bindings through native input.
   *
   * The shared client installs its DOM dispatcher with `native` set on exactly
   * those two platforms; elsewhere the DOM path already delivers every binding,
   * so forwarding here would run each command twice.
   */
  const scopedInput = device.platform === 'macos' || device.platform === 'windows'

  const keydown = (event: KeyboardEvent): void => {
    if (blocked) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const binding = resolve(event)
    const revision = snapshot?.revision
    if (binding === undefined || revision === undefined) return
    // The key belongs to a command, so the page must not also see it — that is
    // the whole reason this listener runs ahead of the client's own.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) {
      if (binding.secondCode !== undefined) consumed.add(binding.secondCode)
      consumed.add(event.code)
    }
    // A completed press cannot seed another chord.
    held.clear()
    emit({
      kind: 'keyboard',
      revision,
      frameName: '',
      code: binding.code,
      ...(binding.secondCode === undefined ? {} : { secondCode: binding.secondCode }),
      control: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      repeat: event.repeat,
    })
  }

  const keyup = (event: KeyboardEvent): void => {
    if (blocked) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    // Do not expose a release when its press was consumed.
    if (consumed.has(event.code)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    consumed.delete(event.code)
    held.delete(event.code)
    if (MODIFIER_KEY.test(event.code)) held.clear()
  }

  /** @param input - one accepted native input, delivered to the page. */
  const emit = (input: DesktopShortcutInput): void => {
    for (const listener of [...listeners]) {
      try {
        listener(input)
      } catch (error) {
        console.error('[desktop] shortcut listener failed:', error)
      }
    }
  }

  nativeInputReady = listen<DesktopShortcutInput>('desktop-shortcut-input', ({ payload }) => {
    if (disposed || recording || blocked || payload.revision !== snapshot?.revision
      || (payload.kind !== 'iframe' && payload.kind !== 'webview')) return
    emit(payload)
  }).then((unlisten) => {
    if (disposed) unlisten()
    else unlistenNativeInput = unlisten
  })
  void nativeInputReady.catch((error: unknown) => {
    console.error('[desktop] native shortcut input unavailable:', error)
  })

  if (scopedInput) {
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', resetInput)
    window.addEventListener('blur', scheduleFocus)
    window.addEventListener('focus', scheduleFocus)
    document.addEventListener('focusin', scheduleFocus)
    document.addEventListener('focusout', scheduleFocus)
    document.addEventListener('pointerdown', scheduleFocus, true)
    scheduleFocus()
  }

  return {
    mark: device.mark,
    setBlocked: (active) => {
      if (disposed) return
      blocked = active
      resetInput()
      void configureNative()
    },
    shortcuts: {
      get: async (next) => {
        if (disposed) throw new Error('Desktop shortcut carrier is disposed')
        definitions = parseShortcutDefinitions(next)
        persistence.setDefinitions(definitions)
        const result = await persistence.readCurrent()
        await nativeInputReady
        await nativeConfiguration
        return result
      },
      edit: async (edit, revision) => {
        if (disposed) throw new Error('Desktop shortcut carrier is disposed')
        const result = await persistence.edit(parseShortcutEdit(edit), revision)
        await nativeConfiguration
        return result
      },
      subscribe: (listener) => {
        subscribers.add(listener)
        return () => { subscribers.delete(listener) }
      },
      recording: (active) => {
        if (disposed) return Promise.resolve()
        recording = active
        // The recorder reads raw DOM keys, so input held before it opened must
        // not complete a chord underneath it.
        if (active) resetInput()
        return configureNative()
      },
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      focusObserver.disconnect()
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', resetInput)
      window.removeEventListener('blur', scheduleFocus)
      window.removeEventListener('focus', scheduleFocus)
      document.removeEventListener('focusin', scheduleFocus)
      document.removeEventListener('focusout', scheduleFocus)
      document.removeEventListener('pointerdown', scheduleFocus, true)
      unlistenNativeInput?.()
      subscribers.clear()
      listeners.clear()
      persistence.dispose()
    },
    keyboard: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      closeWindow: async (expected) => {
        // Same gate as Electron: only the configuration the user reviewed may
        // close the window, and never while a binding is being recorded.
        if (snapshot === undefined || snapshot.status === 'loading' || snapshot.revision !== expected || recording || blocked) return
        await getCurrentWindow().close()
      },
    },
  }
}

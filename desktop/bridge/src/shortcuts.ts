import { invoke } from '@tauri-apps/api/core'
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
 * Electron splits this across its main process and preload: the main process
 * reads `keybindings.json`, resolves the binding index, and intercepts a matched
 * key before the renderer sees it. A Tauri window has no comparable
 * before-input hook, so this module keeps both halves in one owner — it is the
 * storage adapter the client's `ShortcutPersistence` drives, and it is the
 * capture-phase listener that turns a DOM keydown into the native input the
 * client's `installNativeKeyboard` expects.
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
  return { platform: 'linux', mark: 'linux' }
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
} {
  const device = detectPlatform()
  let definitions: readonly ShortcutDefinition[] = []
  let recording = false
  /** Binding keys the accepted configuration claims, as `bindingKey` strings. */
  let claimed = new Set<string>()
  let snapshot: ShortcutConfigSnapshot | undefined
  const subscribers = new Set<(snapshot: ShortcutConfigSnapshot) => void>()
  const listeners = new Set<(input: DesktopShortcutInput) => void>()
  /** Keys currently down, so a second key can complete a chord. */
  const held = new Set<string>()
  /** Codes one accepted press already consumed; a repeat must not re-fire them. */
  const consumed = new Set<string>()

  /**
   * Republish one accepted snapshot and rebuild the claimed-binding index.
   * @param next - snapshot the storage adapter accepted.
   */
  const publish = (next: ShortcutConfigSnapshot): void => {
    snapshot = next
    claimed = next.status === 'loading'
      ? new Set()
      : new Set(effectiveShortcuts(definitions, next.document, 'desktop', device.platform)
        .flatMap(row => row.binding !== null && row.issue === null && row.conflicts.length === 0
          ? [bindingKey(row.binding)] : []))
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
    if (snapshot === undefined || recording) return undefined
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
    // A chord's first key reached a command, so its release must not reach an
    // input that never saw the press.
    if (consumed.has(event.code)) event.preventDefault()
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

  if (scopedInput) {
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', resetInput)
  }

  return {
    mark: device.mark,
    shortcuts: {
      get: async (next) => {
        definitions = parseShortcutDefinitions(next)
        persistence.setDefinitions(definitions)
        return await persistence.readCurrent()
      },
      edit: async (edit, revision) => await persistence.edit(parseShortcutEdit(edit), revision),
      subscribe: (listener) => {
        subscribers.add(listener)
        return () => { subscribers.delete(listener) }
      },
      recording: (active) => {
        recording = active
        // The recorder reads raw DOM keys, so input held before it opened must
        // not complete a chord underneath it.
        if (active) resetInput()
        return Promise.resolve()
      },
    },
    keyboard: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      closeWindow: async (expected) => {
        // Same gate as Electron: only the configuration the user reviewed may
        // close the window, and never while a binding is being recorded.
        if (snapshot === undefined || snapshot.revision !== expected || recording) return
        await getCurrentWindow().close()
      },
    },
  }
}

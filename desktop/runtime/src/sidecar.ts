import { Console } from 'node:console'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FrameDecoder, systemBridge, writeMessage, type ProtocolWriter,
} from './protocol.ts'

/**
 * The desktop sidecar: boots the standard `web` profile with the desktop
 * overlay (native directory picker + surface glue) on a loopback HTTP port,
 * then bridges only the desktop-owned capabilities — native dialogs and path
 * opening over the system bridge, plus the graceful shutdown request — over
 * the frame protocol.
 *
 * Everything else (the index document, the boot manifest, plugin bundles,
 * /api transport, event streams, the session-export download) is served by
 * the real Harness web host at `http://127.0.0.1:<port>`, which the Tauri
 * WebView loads directly. The readiness message carries that URL; when the
 * composed client graph changes (a profile patch hot-reload), the shell
 * receives `graph-changed` and reloads the page — the same semantics as
 * refreshing a browser tab.
 */

const PROTOCOL_VERSION = 1
/** Self-imposed cap on the host boot; the Rust side enforces 120s overall. */
const BOOT_TIMEOUT_MS = 90_000
const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeManifest = join(runtimeRoot, 'package.json')
const overlayPath = join(runtimeRoot, 'overlay.yml')

const protocolWrite = process.stdout.write.bind(process.stdout)
const write: ProtocolWriter = (frame) => {
  protocolWrite(Buffer.from(frame))
}

function redirectHarnessOutput(): void {
  const stderrWrite = process.stderr.write.bind(process.stderr)
  Object.defineProperty(process.stdout, 'write', { value: stderrWrite })
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr })
}

redirectHarnessOutput()
systemBridge.install(write)

interface DesktopRuntimeContext {
  loader: { await(): Promise<void>; entries(): Iterable<LoaderEntry> }
  get(name: string): unknown
}

interface LoaderEntry {
  options: { name?: string }
  fiber?: { state?: number | string }
}

interface RunningProfile {
  ctx: unknown
  shutdown: { shutdown(code: number): Promise<void> }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const nested = error instanceof AggregateError
    ? error.errors
    : error.cause === undefined
      ? []
      : [error.cause]
  const details = nested.map(value => errorMessage(value).replaceAll('\n', '\n  '))
  return [`${error.name}: ${error.message}`, ...details.map(value => `  ${value}`)].join('\n')
}

/** Describe loader entries that never activated (the pending-entry audit). */
function stalledEntries(ctx: DesktopRuntimeContext): string[] {
  const stalled: string[] = []
  for (const entry of ctx.loader.entries()) {
    const name = entry.options.name ?? '<anonymous>'
    if (entry.fiber === undefined) stalled.push(`${name}: import failed`)
    else if (entry.fiber.state !== 2 && entry.fiber.state !== 'active') {
      stalled.push(`${name}: state ${String(entry.fiber.state)}`)
    }
  }
  return stalled
}

async function handleRequest(
  running: RunningProfile,
  method: string,
): Promise<unknown> {
  if (method === 'shutdown') {
    await running.shutdown.shutdown(0)
    setTimeout(() => { process.exit(0) }, 10)
    return {}
  }
  throw new Error(`unknown Desktop request ${JSON.stringify(method)}`)
}

async function serve(): Promise<void> {
  const appBoot = await import('@deepseek-ai/dsh-app-boot')
  appBoot.healProfilesModuleFallback(runtimeManifest)
  const profileBoot = await import(new URL('./profile-boot.mjs', import.meta.url).href) as unknown as {
    runProfile(options: {
      environment: ReturnType<typeof appBoot.loadLayeredEnv>
      profile: string
      patchFiles: readonly string[]
      args: readonly string[]
    }): Promise<RunningProfile>
  }
  const running = await profileBoot.runProfile({
    environment: appBoot.loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [overlayPath],
    args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
  })
  const ctx = running.ctx as DesktopRuntimeContext
  // Bounded boot with a diagnostic audit: a composition whose rows never
  // activate must fail loud instead of hanging the readiness handshake.
  const settled = await Promise.race([
    ctx.loader.await().then(() => 'settled' as const),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => { resolve('timeout') }, BOOT_TIMEOUT_MS).unref()
    }),
  ])
  if (settled === 'timeout') {
    const stalled = stalledEntries(ctx)
    throw new Error(`desktop host boot did not settle within ${BOOT_TIMEOUT_MS}ms\n${stalled.join('\n')}`)
  }
  const port = (ctx.get('webServer') as { port?: number } | undefined)?.port
  if (typeof port !== 'number' || port < 1) {
    throw new Error('desktop webserver did not report a bound port')
  }
  const origin = `http://127.0.0.1:${port}`

  writeMessage(write, {
    kind: 'ready',
    protocolVersion: PROTOCOL_VERSION,
    url: origin,
  })

  // Push graph recompositions (profile patch hot-reloads) so the shell can
  // reload the page — the desktop equivalent of refreshing a browser tab.
  const modules = ctx.get('clientModules') as {
    onGraphChanged(listener: () => void): () => void
  } | undefined
  modules?.onGraphChanged(() => {
    writeMessage(write, { kind: 'graph-changed' })
  })

  const decoder = new FrameDecoder()
  process.stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk)) {
      if (systemBridge.settle(message)) continue
      if (message.kind !== 'request' || typeof message.id !== 'number' || typeof message.method !== 'string') continue
      const requestId = message.id
      const method = message.method
      void handleRequest(running, method).then((response) => {
        writeMessage(write, { kind: 'response', id: requestId, ok: true, payload: response })
      }, (error: unknown) => {
        writeMessage(write, { kind: 'response', id: requestId, ok: false, error: errorMessage(error) })
      })
    }
  })
}

/** Exit the Node sidecar if its Tauri owner disappears abruptly. */
function exitOrphanedSidecar(): never {
  process.exit(1)
}

const parentPid = process.ppid
setInterval(() => {
  if (process.ppid !== parentPid || process.ppid === 1) exitOrphanedSidecar()
  try {
    process.kill(parentPid, 0)
  } catch {
    exitOrphanedSidecar()
  }
}, 2000).unref()

void serve().catch((error: unknown) => {
  writeMessage(write, { kind: 'fatal', error: errorMessage(error) })
  process.exitCode = 1
})

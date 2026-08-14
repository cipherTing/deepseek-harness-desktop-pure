import { randomUUID } from 'node:crypto'
import { Console } from 'node:console'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { RpcId, type ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import {
  FrameDecoder, systemBridge, writeMessage, type ProtocolWriter,
} from './protocol.ts'
import type { DesktopHttpRequest, DesktopWebServer } from './webserver.ts'

const PROTOCOL_VERSION = 1
const MUX_EVENTS_PATH = '/api/events.mux'
const HOST_EVENTS_PATH = '/api/events.host'
const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeManifest = join(runtimeRoot, 'package.json')
const overlayPath = join(runtimeRoot, 'overlay.yml')
const desktopHead = [
  '<head>',
  '<style>html,body{overscroll-behavior:none}</style>',
  '<script src="/desktop-bridge.js"></script>',
].join('')

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

interface ActiveStream {
  readonly abort: AbortController
  credits: number
  readonly waiters: (() => void)[]
}

type EventStreamKind = 'mux' | 'host'

interface DesktopRuntimeContext {
  apiProxy: ApiProxy
  clientModules: ClientModuleRegistry
  loader: { await(): Promise<void> }
  webServer: DesktopWebServer
}

interface RunningProfile {
  ctx: unknown
  shutdown: { shutdown(code: number): Promise<void> }
}

interface RuntimeServices {
  ctx: DesktopRuntimeContext
  modules: ClientModuleRegistry
  running: RunningProfile
  webServer: DesktopWebServer
}

const streams = new Map<number, ActiveStream>()
const requests = new Map<number, AbortController>()
let nextStreamId = 1

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

function abortError(signal: AbortSignal, message: string): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(message, 'AbortError')
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  return value as Record<string, unknown>
}

function streamCredit(stream: ActiveStream, count: number): void {
  stream.credits += count
  while (stream.credits > 0 && stream.waiters.length > 0) stream.waiters.shift()?.()
}

function awaitCredit(stream: ActiveStream, consume: boolean): Promise<void> {
  stream.abort.signal.throwIfAborted()
  if (stream.credits > 0) {
    if (consume) stream.credits -= 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const done = (): void => {
      stream.abort.signal.removeEventListener('abort', aborted)
      if (consume) stream.credits -= 1
      resolve()
    }
    const aborted = (): void => {
      const at = stream.waiters.indexOf(done)
      if (at !== -1) stream.waiters.splice(at, 1)
      reject(abortError(stream.abort.signal, 'Desktop stream cancelled'))
    }
    stream.waiters.push(done)
    stream.abort.signal.addEventListener('abort', aborted, { once: true })
  })
}

function consumeCredit(stream: ActiveStream): Promise<void> {
  return awaitCredit(stream, true)
}

function waitForCredit(stream: ActiveStream): Promise<void> {
  return awaitCredit(stream, false)
}

async function openEventStream(
  ctx: DesktopRuntimeContext,
  kind: EventStreamKind,
  streamId: number,
  stream: ActiveStream,
): Promise<void> {
  await waitForCredit(stream)
  const rpcId = RpcId(randomUUID())
  const source = kind === 'mux'
    ? ctx.apiProxy.events.mux({ rpcId, payload: {} }, stream.abort.signal)
    : ctx.apiProxy.events.host({ rpcId, payload: {} }, stream.abort.signal)
  writeMessage(write, { kind: 'stream-open', streamId })
  for await (const frame of source) {
    await consumeCredit(stream)
    writeMessage(write, {
      kind: 'stream-data',
      streamId,
      payload: JSON.stringify({
        type: 'server-request',
        rpcId: frame.rpcId,
        method: frame.payload.type,
        payload: frame.payload,
      }),
    })
  }
}

async function openHttpStream(
  webServer: DesktopWebServer,
  request: DesktopHttpRequest,
  streamId: number,
  stream: ActiveStream,
): Promise<void> {
  const response = { headSent: false }
  await waitForCredit(stream)
  await webServer.dispatch(request, {
    head(status, headers) {
      response.headSent = true
      writeMessage(write, { kind: 'stream-open', streamId, status, headers })
    },
    async chunk(chunk) {
      await consumeCredit(stream)
      writeMessage(write, { kind: 'stream-data', streamId, payload: chunk })
    },
  }, stream.abort.signal)
  if (!response.headSent) writeMessage(write, { kind: 'stream-open', streamId, status: 200, headers: {} })
}

function startStream(task: (streamId: number, stream: ActiveStream) => Promise<void>): number {
  const streamId = nextStreamId++
  const stream: ActiveStream = { abort: new AbortController(), credits: 0, waiters: [] }
  streams.set(streamId, stream)
  void task(streamId, stream).then(() => {
    writeMessage(write, { kind: 'stream-end', streamId })
  }, (error: unknown) => {
    if (!stream.abort.signal.aborted) {
      writeMessage(write, { kind: 'stream-end', streamId, error: errorMessage(error) })
    } else {
      writeMessage(write, { kind: 'stream-end', streamId })
    }
  }).finally(() => {
    streams.delete(streamId)
  })
  return streamId
}

function decodeBody(value: unknown): Uint8Array | undefined {
  return value instanceof Uint8Array ? value : undefined
}

function httpRequest(payload: unknown): DesktopHttpRequest {
  const input = record(payload, 'Desktop HTTP request')
  if (typeof input.method !== 'string' || typeof input.url !== 'string') {
    throw new Error('invalid Desktop HTTP request')
  }
  const headers = typeof input.headers === 'object' && input.headers !== null
    ? Object.fromEntries(Object.entries(input.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined
  const body = decodeBody(input.body)
  return {
    method: input.method,
    url: input.url,
    ...(headers === undefined ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
  }
}

function eventStreamKind(path: string): EventStreamKind {
  if (path === MUX_EVENTS_PATH) return 'mux'
  if (path === HOST_EVENTS_PATH) return 'host'
  throw new Error(`unsupported Desktop event stream ${JSON.stringify(path)}`)
}

async function handleRequest(
  services: RuntimeServices,
  method: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  switch (method) {
    case 'http.fetch':
      return await services.webServer.fetch(httpRequest(payload), signal)
    case 'stream.events': {
      const input = record(payload, 'stream.events payload')
      if (typeof input.path !== 'string') throw new Error('stream.events path is required')
      const kind = eventStreamKind(input.path)
      return {
        streamId: startStream((streamId, stream) => (
          openEventStream(services.ctx, kind, streamId, stream)
        )),
      }
    }
    case 'stream.http':
      return {
        streamId: startStream((streamId, stream) => (
          openHttpStream(services.webServer, httpRequest(payload), streamId, stream)
        )),
      }
    case 'plugin.read': {
      const input = record(payload, 'plugin.read payload')
      if (typeof input.id !== 'string' || typeof input.rev !== 'string') {
        throw new Error('plugin id and rev are required')
      }
      const entry = services.modules.graph().entries.find(candidate => (
        candidate.id === input.id && candidate.rev === input.rev
      ))
      if (entry === undefined) throw new Error('plugin is not present in the current Desktop manifest')
      const path = services.modules.clientPath(input.id)
      if (path === undefined) throw new Error('plugin bundle path is unavailable')
      return { body: readFileSync(path) }
    }
    case 'shutdown':
      await services.running.shutdown.shutdown(0)
      setTimeout(() => { process.exit(0) }, 10)
      return {}
    default:
      throw new Error(`unknown Desktop request ${JSON.stringify(method)}`)
  }
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
    args: [],
  })
  const ctx = running.ctx as DesktopRuntimeContext
  await ctx.loader.await()
  const webServer = ctx.webServer
  const modules = ctx.clientModules
  const services: RuntimeServices = { ctx, modules, running, webServer }
  const rawIndex = readFileSync(join(dirname(runtimeRoot), 'web/index.html'), 'utf8')
  const tappedIndex = webServer.applyIndexTaps(rawIndex)
  const indexHtml = tappedIndex.replace('<head>', desktopHead)
  const graph = modules.graph()

  writeMessage(write, {
    kind: 'ready',
    protocolVersion: PROTOCOL_VERSION,
    graph,
    graphJson: JSON.stringify(graph),
    indexHtml,
  })

  const decoder = new FrameDecoder()
  process.stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk)) {
      if (systemBridge.settle(message)) continue
      if (message.kind === 'credit' && typeof message.streamId === 'number' && typeof message.count === 'number') {
        const stream = streams.get(message.streamId)
        if (stream !== undefined) streamCredit(stream, message.count)
        continue
      }
      if (message.kind === 'cancel' && typeof message.streamId === 'number') {
        streams.get(message.streamId)?.abort.abort(new DOMException('Desktop stream cancelled', 'AbortError'))
        continue
      }
      if (message.kind === 'request-cancel' && typeof message.id === 'number') {
        requests.get(message.id)?.abort(new DOMException('Desktop request cancelled', 'AbortError'))
        continue
      }
      if (message.kind !== 'request' || typeof message.id !== 'number' || typeof message.method !== 'string') continue
      const requestId = message.id
      const method = message.method
      const controller = new AbortController()
      requests.set(requestId, controller)
      void handleRequest(services, method, message.payload, controller.signal).then((response) => {
        writeMessage(write, { kind: 'response', id: requestId, ok: true, payload: response })
      }, (error: unknown) => {
        writeMessage(write, { kind: 'response', id: requestId, ok: false, error: errorMessage(error) })
      }).finally(() => {
        requests.delete(requestId)
      })
    }
  })
}

const parentPid = process.ppid
setInterval(() => {
  if (process.ppid !== parentPid || process.ppid === 1) process.exit(1)
  try {
    process.kill(parentPid, 0)
  } catch {
    process.exit(1)
  }
}, 2000).unref()

void serve().catch((error: unknown) => {
  writeMessage(write, { kind: 'fatal', error: errorMessage(error) })
  process.exitCode = 1
})

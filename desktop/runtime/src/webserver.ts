import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  WebRoute, WebUpgradeRoute,
} from '@deepseek-ai/dsh-host-webserver'

export interface DesktopHttpRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: Uint8Array
}

export interface DesktopHttpResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

interface ResponseSink {
  head(status: number, headers: Record<string, string>): void | Promise<void>
  chunk(chunk: Uint8Array): void | Promise<void>
}

type RouteRequest = Parameters<WebRoute['handler']>[0]
type RouteResponse = Parameters<WebRoute['handler']>[1]

class MemoryRequest extends Readable {
  readonly headers: Record<string, string>
  readonly method: string
  readonly url: string
  private sent = false

  constructor(request: DesktopHttpRequest) {
    super()
    this.method = request.method
    this.url = request.url
    this.headers = {
      host: '127.0.0.1',
      ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    }
    if (request.body !== undefined) this.headers['content-length'] = String(request.body.byteLength)
    this.body = request.body
  }

  private readonly body: Uint8Array | undefined

  override _read(): void {
    if (this.sent) return
    this.sent = true
    if (this.body !== undefined) this.push(Buffer.from(this.body))
    this.push(null)
  }
}

class MemoryResponse extends EventEmitter {
  statusCode = 200
  headersSent = false
  writableEnded = false
  private destroyed = false
  private readonly headers = new Map<string, string>()
  private readonly pending = new Set<Promise<void>>()
  private readonly ended: Promise<void>
  private finish: () => void = () => {}

  constructor(private readonly sink: ResponseSink, signal?: AbortSignal) {
    super()
    this.ended = new Promise((resolve) => { this.finish = resolve })
    if (signal !== undefined) {
      const abort = (): void => { queueMicrotask(() => { this.destroy() }) }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      void this.ended.finally(() => { signal.removeEventListener('abort', abort) })
    }
  }

  writeHead(status: number, headers: Record<string, string | number | readonly string[]> = {}): this {
    if (this.writableEnded) return this
    this.statusCode = status
    for (const [name, value] of Object.entries(headers)) {
      this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
    }
    if (!this.headersSent) {
      this.headersSent = true
      this.track(Promise.resolve(this.sink.head(this.statusCode, Object.fromEntries(this.headers))))
    }
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
  }

  write(chunk: string | Uint8Array): boolean {
    // A route may finish producing its Fetch response after the Desktop
    // transport has been cancelled. Treat those discarded writes as consumed;
    // returning false would make the node:http bridge wait for a future drain.
    if (this.destroyed) return true
    if (this.writableEnded) return false
    if (!this.headersSent) this.writeHead(this.statusCode)
    this.track(Promise.resolve(this.sink.chunk(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)))
    return this.pending.size < 8
  }

  end(chunk?: string | Uint8Array): void {
    if (this.writableEnded) return
    if (chunk !== undefined) this.write(chunk)
    else if (!this.headersSent) this.writeHead(this.statusCode)
    this.writableEnded = true
    void Promise.allSettled([...this.pending]).then(() => {
      this.emit('close')
      this.finish()
    })
  }

  destroy(): void {
    if (this.writableEnded) return
    // Match node:http: a transport close is observable before writableEnded,
    // allowing the existing Harness bridge to distinguish abort from end().
    this.destroyed = true
    this.emit('close')
    this.writableEnded = true
    this.finish()
  }

  wait(): Promise<void> {
    return this.ended
  }

  private track(promise: Promise<void>): void {
    this.pending.add(promise)
    const settled = (): void => {
      this.pending.delete(promise)
      if (this.pending.size < 8) this.emit('drain')
    }
    void promise.then(settled, settled)
  }
}

export class DesktopWebServer extends Service {
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  get host(): '127.0.0.1' {
    return '127.0.0.1'
  }

  get port(): number {
    return 0
  }

  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) throw new Error(`desktop webserver: duplicate ${route.kind} route ${JSON.stringify(route.path)}`)
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) throw new Error(`desktop webserver: duplicate upgrade route ${JSON.stringify(route.path)}`)
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) throw new Error('desktop webserver: fallback already registered')
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const index = this.indexTaps.indexOf(transform)
      if (index !== -1) this.indexTaps.splice(index, 1)
    }
  }

  applyIndexTaps(html: string): string {
    return this.indexTaps.reduce((value, transform) => transform(value), html)
  }

  async dispatch(request: DesktopHttpRequest, sink: ResponseSink, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const pathname = new URL(request.url, 'http://dsh.internal').pathname
    const route = this.match(pathname)
    const response = new MemoryResponse(sink, signal)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      await response.wait()
      signal?.throwIfAborted()
      return
    }
    await route.handler(
      new MemoryRequest(request) as unknown as RouteRequest,
      response as unknown as RouteResponse,
    )
    if (!response.writableEnded) response.end()
    await response.wait()
    signal?.throwIfAborted()
  }

  async fetch(request: DesktopHttpRequest, signal?: AbortSignal): Promise<DesktopHttpResponse> {
    let status = 500
    let headers: Record<string, string> = {}
    const chunks: Uint8Array[] = []
    await this.dispatch(request, {
      head(nextStatus, nextHeaders) {
        status = nextStatus
        headers = nextHeaders
      },
      chunk(chunk) {
        chunks.push(Buffer.from(chunk))
      },
    }, signal)
    return { status, headers, body: Buffer.concat(chunks) }
  }

  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best ?? (this.fallback === undefined ? undefined : {
      kind: 'prefix',
      path: '/',
      handler: this.fallback,
    })
  }
}

export default DesktopWebServer

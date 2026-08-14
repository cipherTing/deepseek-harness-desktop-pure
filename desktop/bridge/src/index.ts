import { Channel, invoke } from '@tauri-apps/api/core'

interface DesktopHttpResponse {
  status: number
  headers: Record<string, string>
  body: number[] | Uint8Array
}

interface StreamEvent {
  kind: 'open' | 'message' | 'close' | 'error'
  streamId?: number
  payload?: string
  error?: string
}

const nativeFetch = globalThis.fetch.bind(globalThis)
const API_PATH = '/api'

function bytes(value: number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value)
}

function shouldUseDesktopCarrier(request: Request): boolean {
  const { pathname } = new URL(request.url)
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function createRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => (
    value.toString(16).padStart(2, '0')
  )).join('')
}

function cancellation(
  signal: AbortSignal,
  cancel: () => Promise<unknown>,
): { readonly promise: Promise<never>; dispose(): void } {
  let abort: () => void = () => {}
  const promise = new Promise<never>((_resolve, reject) => {
    abort = (): void => {
      void cancel().catch(() => {})
      reject(abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  return {
    promise,
    dispose: () => { signal.removeEventListener('abort', abort) },
  }
}

async function desktopFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  if (!shouldUseDesktopCarrier(request)) return await nativeFetch(request)
  ensureActive(request.signal)
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : new Uint8Array(await request.arrayBuffer())
  ensureActive(request.signal)
  const headers = Object.fromEntries(request.headers.entries())
  const requestId = createRequestId()
  const call = invoke<DesktopHttpResponse>('desktop_fetch', {
    requestId,
    request: {
      method: request.method,
      url: request.url,
      headers,
      body,
    },
  })
  const cancelled = cancellation(
    request.signal,
    async () => await invoke('desktop_fetch_cancel', { requestId }),
  )
  let result: DesktopHttpResponse
  try {
    result = await Promise.race([call, cancelled.promise])
  } finally {
    cancelled.dispose()
  }
  const responseBody = bytes(result.body)
  return new Response(responseBody, { status: result.status, headers: result.headers })
}

class DesktopWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readonly url: string
  readonly protocol = ''
  readonly extensions = ''
  bufferedAmount = 0
  binaryType: BinaryType = 'blob'
  readyState: 0 | 1 | 2 | 3 = DesktopWebSocket.CONNECTING
  onopen: WebSocket['onopen'] = null
  onmessage: WebSocket['onmessage'] = null
  onerror: WebSocket['onerror'] = null
  onclose: WebSocket['onclose'] = null
  private streamId: number | undefined

  constructor(url: string | URL, _protocols?: string | string[]) {
    super()
    this.url = String(url)
    const channel = new Channel<StreamEvent>()
    channel.onmessage = (event) => { this.receive(event) }
    void invoke<{ streamId: number }>('desktop_stream_open', {
      path: new URL(this.url).pathname,
      onEvent: channel,
    }).then(({ streamId }) => {
      this.streamId = streamId
      if (this.readyState === DesktopWebSocket.CLOSING || this.readyState === DesktopWebSocket.CLOSED) {
        void invoke('desktop_stream_close', { streamId }).catch(() => {})
      }
    }, (error: unknown) => {
      this.fail(String(error))
    })
  }

  send(): void {
    throw new DOMException('DeepSeek Harness event sockets are downlink-only', 'InvalidStateError')
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === DesktopWebSocket.CLOSED || this.readyState === DesktopWebSocket.CLOSING) return
    this.readyState = DesktopWebSocket.CLOSING
    const streamId = this.streamId
    if (streamId === undefined) {
      this.finishClose(code, reason)
      return
    }
    void invoke('desktop_stream_close', { streamId }).then(
      () => { this.finishClose(code, reason) },
      () => { this.finishClose(code, reason) },
    )
  }

  private receive(event: StreamEvent): void {
    switch (event.kind) {
      case 'open': {
        if (this.readyState !== DesktopWebSocket.CONNECTING) return
        this.streamId = event.streamId ?? this.streamId
        this.readyState = DesktopWebSocket.OPEN
        const opened = new Event('open')
        this.dispatchEvent(opened)
        this.onopen?.call(this, opened)
        break
      }
      case 'message': {
        if (this.readyState !== DesktopWebSocket.OPEN) return
        const message = new MessageEvent('message', { data: event.payload ?? '' })
        this.dispatchEvent(message)
        this.onmessage?.call(this, message)
        break
      }
      case 'error':
        this.fail(event.error ?? 'Desktop stream failed')
        break
      case 'close':
        this.finishClose(1000, '')
        break
    }
  }

  private fail(message: string): void {
    if (this.readyState === DesktopWebSocket.CLOSED) return
    const error = new ErrorEvent('error', { message })
    this.dispatchEvent(error)
    this.onerror?.call(this, error)
    this.finishClose(1011, message)
  }

  private finishClose(code: number, reason: string): void {
    if (this.readyState === DesktopWebSocket.CLOSED) return
    this.readyState = DesktopWebSocket.CLOSED
    const closed = new CloseEvent('close', { code, reason, wasClean: code === 1000 })
    this.dispatchEvent(closed)
    this.onclose?.call(this, closed)
  }
}

globalThis.fetch = desktopFetch
globalThis.WebSocket = DesktopWebSocket

// Capture the native method before installing the Desktop export interceptor.
// oxlint-disable-next-line typescript/unbound-method -- Reflect.apply supplies the original receiver explicitly.
const nativeAnchorClick = HTMLAnchorElement.prototype.click
HTMLAnchorElement.prototype.click = function desktopAnchorClick(): void {
  let url: URL
  try {
    url = new URL(this.href, location.href)
  } catch {
    Reflect.apply(nativeAnchorClick, this, [])
    return
  }
  if (url.pathname !== '/api/session.export' || this.download === '') {
    Reflect.apply(nativeAnchorClick, this, [])
    return
  }
  void invoke('desktop_save_session', {
    request: {
      method: 'GET',
      url: url.toString(),
      headers: {},
    },
    filename: this.download,
  }).catch((error: unknown) => {
    console.error('[desktop] session export failed:', error)
  })
}

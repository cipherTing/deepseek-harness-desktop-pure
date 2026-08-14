import { decode, encode } from '@msgpack/msgpack'

export interface ProtocolMessage {
  kind: string
  [key: string]: unknown
}

export type ProtocolWriter = (frame: Uint8Array) => void

function protocolMessage(value: unknown): ProtocolMessage {
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string') {
    throw new Error('desktop protocol message must contain a string kind')
  }
  return value as ProtocolMessage
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Uint8Array): ProtocolMessage[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const messages: ProtocolMessage[] = []
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length > 256 * 1024 * 1024) throw new Error(`desktop protocol frame too large: ${String(length)}`)
      if (this.buffer.byteLength < 4 + length) break
      messages.push(protocolMessage(decode(this.buffer.subarray(4, 4 + length))))
      this.buffer = this.buffer.subarray(4 + length)
    }
    return messages
  }
}

export function writeMessage(write: ProtocolWriter, message: ProtocolMessage): void {
  const payload = encode(message)
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.byteLength)
  write(Buffer.concat([header, payload]))
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError')
}

export class SystemBridge {
  private write: ProtocolWriter | undefined
  private nextId = 1
  private readonly pending = new Map<number, {
    resolve(value: unknown): void
    reject(error: unknown): void
  }>()

  install(write: ProtocolWriter): void {
    this.write = write
  }

  async request<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const write = this.write
    if (write === undefined) throw new Error('desktop system bridge is not installed')
    if (signal?.aborted === true) throw abortError()
    const id = this.nextId++
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => { resolve(value as T) }, reject })
    })
    const abort = (): void => {
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      writeMessage(write, { kind: 'system-cancel', id })
      pending.reject(abortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
    writeMessage(write, { kind: 'system-request', id, method, payload })
    try {
      return await promise
    } finally {
      signal?.removeEventListener('abort', abort)
      this.pending.delete(id)
    }
  }

  settle(message: ProtocolMessage): boolean {
    if (message.kind !== 'system-response' || typeof message.id !== 'number') return false
    const pending = this.pending.get(message.id)
    if (pending === undefined) return true
    this.pending.delete(message.id)
    if (message.ok === true) pending.resolve(message.payload)
    else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'desktop system request failed'))
    return true
  }
}

export const systemBridge = new SystemBridge()

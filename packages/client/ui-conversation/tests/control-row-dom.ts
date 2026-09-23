/** jsdom omits resize observation and font loading; layout tests drive their own measurements. */
import { beforeEach, afterEach, vi } from 'vitest'

const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (fonts === undefined) Reflect.deleteProperty(document, 'fonts')
  else Object.defineProperty(document, 'fonts', fonts)
})

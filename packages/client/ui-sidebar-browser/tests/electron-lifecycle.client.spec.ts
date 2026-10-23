// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopBrowserReservation } from '../src/types.ts'
import { electronFixture } from './electron-harness.client.ts'

const target = { kind: 'https' as const, url: 'https://example.test/', title: 'Example' }
const fixtures: ReturnType<typeof electronFixture>[] = []
function fixture() {
  const h = electronFixture()
  fixtures.push(h)
  return h
}
afterEach(async () => {
  for (const h of fixtures.splice(0)) await h.dispose()
})

it('waits for a mounted container and observes host history, titles and new-tab requests', async () => {
  const h = fixture()
  h.frame.goBack()
  h.frame.goForward()
  h.frame.reload()
  h.frame.loadUrl(target)
  expect(h.bridge.acquire).not.toHaveBeenCalled()
  h.mount()
  const anchor = await h.anchor()
  expect(anchor.getAttribute('name')).toBe(h.reservation.lease)
  expect(anchor.getAttribute('partition')).toBe(h.reservation.partition)
  expect(anchor.dataset.sidebarBrowserAnchor).toBe('true')
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledWith('cwd:/workspace', target.url) })
  expect(h.bridge.navigate).not.toHaveBeenCalled()
  h.hostState.url = target.url
  h.hostState.title = 'Title'
  h.hostState.canGoBack = true
  h.hostState.canGoForward = true
  h.emit('navigated')
  expect(h.frame.getSnapshot()).toMatchObject({ address: 'observed', target: { ...target, title: 'Title' } })
  expect(anchor.getAttribute('aria-label')).toBe('Title')
  const writes = h.persist.mock.calls.length
  h.emit('title')
  expect(h.persist).toHaveBeenCalledTimes(writes)
  h.frame.loadUrl(target)
  h.frame.goBack()
  h.frame.goForward()
  expect(h.bridge.command).toHaveBeenNthCalledWith(1, h.reservation.lease, 'reload')
  expect(h.bridge.command).toHaveBeenNthCalledWith(2, h.reservation.lease, 'back')
  expect(h.bridge.command).toHaveBeenNthCalledWith(3, h.reservation.lease, 'forward')
  h.hostState.url = `${target.url}next`
  h.emit('navigated')
  expect(h.frame.getSnapshot().target?.url).toBe(`${target.url}next`)
  h.hostState.title = ''
  h.hostState.loading = false
  h.emit('title')
  h.emit('load-finished')
  expect(h.frame.getSnapshot()).toMatchObject({
    loading: false, target: { url: h.hostState.url, title: 'example.test' },
  })
  const open = h.bridge.onOpenRequested.mock.calls[0]![1]
  open('https://new.example/')
  expect(h.openRequested).toHaveBeenCalledOnce()
  await h.frame.dispose()
  open('https://late.example/')
  h.emit('navigated')
  h.frame.loadUrl(target)
  h.frame.reload()
  h.frame.goBack()
  expect(h.openRequested).toHaveBeenCalledOnce()
  expect(h.opens.size).toBe(0)
  expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
})

it('observes pushState and popstate URL and native history updates', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  await h.anchor()

  h.hostState.url = target.url
  h.hostState.loading = false
  h.emit('navigated')
  const initialCheckpoints = h.persist.mock.calls.length
  h.hostState.url = 'https://example.test/in-page'
  h.hostState.canGoBack = true
  h.hostState.canGoForward = false
  h.emit('history-changed')
  expect(h.frame.getSnapshot()).toMatchObject({
    target: { url: h.hostState.url }, canGoBack: true, canGoForward: false,
  })
  const pushedCheckpoints = h.persist.mock.calls.length
  expect(pushedCheckpoints).toBeGreaterThan(initialCheckpoints)

  h.hostState.url = target.url
  h.hostState.canGoBack = false
  h.hostState.canGoForward = true
  h.emit('history-changed')
  expect(h.frame.getSnapshot()).toMatchObject({
    target: { url: target.url }, canGoBack: false, canGoForward: true,
  })
  expect(h.persist.mock.calls.length).toBeGreaterThan(pushedCheckpoints)
})

it('releases an acquisition that finishes after attachment cancellation', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<DesktopBrowserReservation>()
  h.bridge.acquire.mockReturnValueOnce(pending.promise)
  const unmount = h.mount()
  h.frame.loadUrl(target)
  try {
    await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledOnce() })
    unmount()
    const disposed = h.frame.dispose()
    expect(h.frame.dispose()).toBe(disposed)
    pending.resolve(h.reservation)
    await disposed
    expect(h.anchors).toHaveLength(0)
    expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
  } finally {
    pending.resolve(h.reservation)
  }
})

it('does not acquire a guest when Workspace resolution finishes after disposal', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<string>()
  h.workspace.mockReturnValueOnce(pending.promise)
  h.mount()
  h.frame.loadUrl(target)
  try {
    const disposed = h.frame.dispose()
    pending.resolve('cwd:/late')
    await disposed
    expect(h.bridge.acquire).not.toHaveBeenCalled()
    h.mount()
    expect(h.anchors).toHaveLength(0)
  } finally {
    pending.resolve('cwd:/late')
  }
})

it('recreates the guest after physical remount without resolving Workspace again', async () => {
  const h = fixture()
  const unmount = h.mount()
  h.frame.loadUrl(target)
  const first = await h.anchor()
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledWith('cwd:/workspace', target.url) })
  expect(h.bridge.navigate).not.toHaveBeenCalled()
  h.hostState.url = target.url
  h.emit('navigated')
  unmount()
  h.mount()
  await vi.waitFor(() => { expect(h.anchors.length).toBe(2) })
  const second = await h.anchor()
  expect(second).not.toBe(first)
  expect(h.workspace).toHaveBeenCalledOnce()
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledTimes(2) })
  expect(h.bridge.acquire).toHaveBeenLastCalledWith('cwd:/workspace', target.url)
  expect(h.bridge.navigate).not.toHaveBeenCalled()
})

it('loads the latest address when it changes during guest acquisition', async () => {
  const h = fixture()
  const acquiring = Promise.withResolvers<DesktopBrowserReservation>()
  h.bridge.acquire.mockReturnValueOnce(acquiring.promise)
  h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledOnce() })
  h.frame.loadUrl({ kind: 'https', url: 'https://next.example/', title: 'Next' })
  acquiring.resolve(h.reservation)
  await vi.waitFor(() => {
    expect(h.bridge.navigate).toHaveBeenCalledExactlyOnceWith(h.reservation.lease, 'https://next.example/')
  })
  expect(h.bridge.acquire).toHaveBeenCalledExactlyOnceWith('cwd:/workspace', target.url)
})

it('forwards guest focus to DOM owners without moving document focus', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  const anchor = await h.anchor()
  const activeElement = document.activeElement
  const focus = vi.fn()
  h.host.addEventListener('focus', focus, true)
  h.emit('guest-focused')
  expect(focus).toHaveBeenCalledOnce()
  expect(focus.mock.calls[0]![0]).toMatchObject({ type: 'focus', target: anchor, composed: true })
  expect(document.activeElement).toBe(activeElement)
})

it('publishes structured guest load failures and clears them when a retry starts', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  await h.anchor()
  h.hostState.url = target.url
  h.hostState.title = 'Example'
  h.emit('navigated')
  h.hostState.loading = false
  const error = { code: -105, description: 'DNS failure' }
  h.hostState.error = error
  h.emitLoadFailed(error)
  expect(h.frame.getSnapshot()).toMatchObject({
    target: { url: target.url }, loading: false, error,
  })
  delete h.hostState.error
  h.hostState.loading = true
  h.emit('load-started')
  expect(h.frame.getSnapshot()).toMatchObject({ loading: true, error: undefined })
})

it('restores a cached guest load failure during the initial state refresh', async () => {
  const h = fixture()
  h.hostState.url = target.url
  h.hostState.loading = false
  h.hostState.error = { code: -105, description: 'DNS failure' }
  h.mount()
  h.frame.loadUrl(target)
  await h.anchor()
  await vi.waitFor(() => {
    expect(h.frame.getSnapshot()).toMatchObject({
      address: 'observed', target: { url: target.url }, loading: false, error: h.hostState.error,
    })
  })
})

it('contains acquisition, host command and release failures and keeps retry available', async () => {
  const h = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.bridge.acquire.mockRejectedValueOnce(new Error('acquire failed'))
  h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.frame.getSnapshot().error).toBeDefined() })
  h.frame.reload()
  await h.anchor()
  h.hostState.url = target.url
  h.emit('navigated')
  h.bridge.command.mockRejectedValueOnce(new Error('command failed'))
  h.frame.reload()
  await vi.waitFor(() => { expect(h.frame.getSnapshot().error).toBeDefined() })
  h.frame.reload()
  expect(h.frame.getSnapshot().error).toBeUndefined()
  h.bridge.state.mockRejectedValueOnce(new Error('observation failed'))
  h.bridge.release.mockRejectedValueOnce(new Error('release failed'))
  await h.frame.dispose()
  expect(error.mock.calls.some(call => call[0] === 'Desktop browser guest release failed')).toBe(true)
})

it('routes the anchor box to the host and hides the guest once the anchor leaves the screen', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  await h.anchor()
  h.moveAnchor({ x: 40, y: 60, width: 320, height: 480 })
  await vi.waitFor(() => {
    expect(h.bridge.place).toHaveBeenCalledWith(h.reservation.lease,
      { x: 40, y: 60, width: 320, height: 480 }, true)
  })
  const placements = h.bridge.place.mock.calls.length
  // A new box on the next frame is the only thing that sends another command.
  h.moveAnchor({ x: 60, y: 60, width: 320, height: 480 })
  await vi.waitFor(() => { expect(h.bridge.place.mock.calls.length).toBeGreaterThan(placements) })
  h.moveAnchor({ x: 0, y: 0, width: 0, height: 0 })
  await vi.waitFor(() => { expect(h.bridge.setVisible).toHaveBeenCalledWith(h.reservation.lease, false) })
  await h.frame.dispose()
})

it('hides a native guest when DockKit input or a DOM overlay covers its anchor', async () => {
  const h = fixture()
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  const overlay = document.createElement('div')
  h.mount()
  h.frame.loadUrl(target)
  const anchor = await h.anchor()
  h.moveAnchor({ x: 40, y: 60, width: 320, height: 480 })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => anchor) })
  try {
    await vi.waitFor(() => { expect(h.bridge.place).toHaveBeenCalledWith(h.reservation.lease,
      { x: 40, y: 60, width: 320, height: 480 }, true) })
    const placements = h.bridge.place.mock.calls.length
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => overlay) })
    await vi.waitFor(() => { expect(h.bridge.setVisible).toHaveBeenCalledWith(h.reservation.lease, false) })
    expect(h.bridge.place).toHaveBeenCalledTimes(placements)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => anchor) })
    await vi.waitFor(() => { expect(h.bridge.place).toHaveBeenCalledTimes(placements + 1) })
  } finally {
    if (previous === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
    else Object.defineProperty(document, 'elementFromPoint', previous)
  }
})

it('keeps the guest clear of the right-sidebar resize handle without hiding the page', async () => {
  const h = fixture()
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  const handle = document.createElement('div')
  handle.dataset.side = 'rightbar'
  handle.getBoundingClientRect = () => ({
    x: 36, y: 0, left: 36, top: 0, right: 44, bottom: 600, width: 8, height: 600, toJSON: () => ({}),
  })
  h.mount()
  h.frame.loadUrl(target)
  const anchor = await h.anchor()
  h.moveAnchor({ x: 40, y: 60, width: 320, height: 480 })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => handle) })
  try {
    await vi.waitFor(() => {
      expect(h.bridge.place).toHaveBeenCalledWith(h.reservation.lease,
        { x: 44, y: 60, width: 316, height: 480 }, true)
    })
    expect(h.bridge.setVisible).not.toHaveBeenCalledWith(h.reservation.lease, false)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
    else Object.defineProperty(document, 'elementFromPoint', previous)
    await h.frame.dispose()
    anchor.remove()
  }
})

it('serializes hiding after an in-flight placement and discards queued bounds', async () => {
  const h = fixture()
  const pendingPlacement = Promise.withResolvers<undefined>()
  h.bridge.place.mockReturnValueOnce(pendingPlacement.promise)
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  const overlay = document.createElement('div')
  h.mount()
  h.frame.loadUrl(target)
  const anchor = await h.anchor()
  h.moveAnchor({ x: 40, y: 60, width: 320, height: 480 })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => anchor) })
  try {
    await vi.waitFor(() => { expect(h.bridge.place).toHaveBeenCalledOnce() })
    h.moveAnchor({ x: 60, y: 60, width: 320, height: 480 })
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => overlay) })
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    expect(h.bridge.setVisible).not.toHaveBeenCalled()
    pendingPlacement.resolve(undefined)
    await vi.waitFor(() => { expect(h.bridge.setVisible).toHaveBeenCalledWith(h.reservation.lease, false) })
    expect(h.bridge.place).toHaveBeenCalledOnce()
    expect(h.bridge.place.mock.invocationCallOrder[0]).toBeLessThan(h.bridge.setVisible.mock.invocationCallOrder[0]!)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
    else Object.defineProperty(document, 'elementFromPoint', previous)
  }
})

it('treats a host cancellation as the user replacing the navigation', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  await h.anchor()
  h.bridge.navigate.mockRejectedValueOnce(new Error('navigation cancelled: ERR_ABORTED'))
  h.frame.loadUrl({ ...target, url: 'https://example.test/cancelled' })
  await Promise.resolve()
  expect(h.frame.getSnapshot().error).toBeUndefined()
  h.bridge.navigate.mockRejectedValueOnce(new Error('active navigation failed'))
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.frame.getSnapshot().error).toBeDefined() })
})

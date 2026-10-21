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
  await vi.waitFor(() => { expect(h.bridge.navigate).toHaveBeenCalledWith(h.reservation.lease, target.url) })
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
  await vi.waitFor(() => { expect(h.bridge.navigate).toHaveBeenCalledOnce() })
  unmount()
  h.mount()
  await vi.waitFor(() => { expect(h.anchors.length).toBe(2) })
  const second = await h.anchor()
  expect(second).not.toBe(first)
  expect(h.workspace).toHaveBeenCalledOnce()
  await vi.waitFor(() => { expect(h.bridge.navigate).toHaveBeenCalledTimes(2) })
  expect(h.bridge.navigate).toHaveBeenLastCalledWith(h.reservation.lease, target.url)
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
  await h.frame.dispose()
  await vi.waitFor(() => { expect(h.bridge.setVisible).toHaveBeenCalledWith(h.reservation.lease, false) })
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

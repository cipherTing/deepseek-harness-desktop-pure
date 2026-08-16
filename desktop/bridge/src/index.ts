import { invoke } from '@tauri-apps/api/core'

/**
 * Desktop bridge (page side): the ONLY frontend coupling the desktop shell
 * needs. The page is served by the real Harness web host over loopback HTTP,
 * so fetch, EventSource and WebSocket are native — no interception here.
 * WKWebView does not act on the `download` attribute, so session export is
 * the one browser affordance routed through the native save dialog.
 */

// Capture the native method before installing the Desktop export interceptor.
// oxlint-disable-next-line typescript/unbound-method -- Reflect.apply below supplies each anchor as the receiver.
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

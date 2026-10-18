import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { bridgeScript } from './bridge-script.generated.ts'

/**
 * Desktop surface glue over the REAL loopback web host: the desktop prompt
 * section, the per-request index taps (overscroll guard + bridge script), the
 * bridge script route and the desktop-info route (version/repository facts the
 * About section and the update badge read). Everything else is served by the
 * upstream web surface; this plugin only adds the desktop affordances on top
 * of it.
 */
export const name = 'desktop-surface'
export const inject = ['webServer']

/** Version and identity facts for the About section and the update badge. */
interface DesktopInfo {
  desktopVersion: string
  kernelVersion: string | undefined
  repository: string
  author: string
}

function readJson(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Resolve the packaged runtime root (the deployed tree this bundle lives in). */
function runtimeRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Desktop facts, resolved once at boot: the runtime manifest carries the
 * desktop version/repository/author; the harness kernel version comes from
 * the deployed `@deepseek-ai/dsh` package (the upstream CLI version).
 */
function resolveDesktopInfo(): DesktopInfo {
  const root = runtimeRoot()
  const runtime = readJson(join(root, 'package.json'))
  const repositoryUrl = (() => {
    const repository = runtime.repository
    if (typeof repository === 'string') return repository
    if (typeof repository === 'object' && repository !== null && typeof (repository as Record<string, unknown>).url === 'string') {
      return (repository as Record<string, unknown>).url as string
    }
    return ''
  })()
  let kernelVersion: string | undefined
  try {
    const require = createRequire(import.meta.url)
    kernelVersion = readJson(require.resolve('@deepseek-ai/dsh/package.json')).version as string | undefined
  } catch {
    kernelVersion = undefined
  }
  return {
    desktopVersion: typeof runtime.version === 'string' ? runtime.version : '0.0.0',
    kernelVersion,
    repository: repositoryUrl,
    author: typeof runtime.author === 'string' ? runtime.author : '',
  }
}

/**
 * Policy for the served page. Tauri's `security.csp` is injected on Tauri's own
 * protocol responses, and this WebView loads the loopback HTTP host instead, so
 * the policy has to travel as an index meta row. It keeps `object-src` and
 * `base-uri` closed while leaving the sources the client graph needs: inline
 * bootstrap scripts, blob workers, same-origin `EventSource`/WebSocket
 * transports, and preview frames.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* https:",
  "frame-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
].join('; ')

export function apply(ctx: Context): void {
  const info = resolveDesktopInfo()
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: () => 'You are interacting with the user through the DeepDive GUI. The Desktop application is only a native carrier for the same Harness profile, configuration, sessions, workspaces, and user data used by the Web surface. The WebView provides no implicit DOM, route, or screenshot context.',
    })
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/desktop-bridge.js',
    handler: (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(bridgeScript)
    },
  }), 'desktop-surface: bridge script route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/desktop-info.json',
    handler: (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(JSON.stringify(info))
    },
  }), 'desktop-surface: desktop-info route')
  // Structured injection rows: the host renders them immediately after the
  // served document's opening head tag and tolerates that tag's attributes,
  // where a raw string tap silently disappears if the tag ever changes.
  ctx.effect(() => ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
    // First row in the table so the browser reads the policy before any other
    // injected resource.
    table.push(
      {
        kind: 'html',
        placement: 'head',
        html: `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
      },
      { kind: 'style', text: 'html,body{overscroll-behavior:none}' },
      { kind: 'script-src', placement: 'head', src: '/desktop-bridge.js' },
    )
  }), 'desktop-surface: desktop head injection')
}

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
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
  ctx.effect(() => ctx.webServer.tapIndex(html => html.replace('<head>', [
    '<head>',
    '<style>html,body{overscroll-behavior:none}</style>',
    '<script src="/desktop-bridge.js"></script>',
  ].join(''))), 'desktop-surface: desktop head injection')
}

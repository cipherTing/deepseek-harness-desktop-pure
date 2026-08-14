import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'desktop-surface'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.provide('webRuntime', { lanAddresses: [], trustedHosts: [] })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: () => 'You are interacting with the user through the DeepSeek Harness Desktop GUI. The Desktop application is only a native carrier for the same Harness profile, configuration, sessions, workspaces, and user data used by the Web surface. The WebView provides no implicit DOM, route, or screenshot context.',
    })
  })
}

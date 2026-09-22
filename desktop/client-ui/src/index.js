/**
 * Host plugin for the Desktop client contribution package.
 *
 * The package contributes only a browser-side bundle, but Harness still loads
 * every client package through a host plugin entry. That entry declares the one
 * durable Desktop preference behind the update badge — the release whose
 * reminder the user chose to ignore — as the entry's configuration form, which
 * the browser half reads and writes through `ctx.configForms`.
 */
import z from '@deepseek-ai/schemastery'

/**
 * Profile entry id this form is addressed by: the Desktop overlay's row id.
 * The browser half resolves the same id, and the form's section lives in the
 * profile patch like every other entry's config.
 */
export const DESKTOP_CLIENT_UI_ENTRY = 'desktop-client-ui'

/**
 * Entry configuration. The field stays absent until the user ignores a
 * release, and clearing it restores the reminder.
 */
export const Config = z.object({
  ignoredUpdateVersion: z.string(),
})

/**
 * Keep this entry out of the generated settings pages, which the package
 * replaces with its own About page.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}

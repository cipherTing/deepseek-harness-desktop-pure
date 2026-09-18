/**
 * Host plugin for the Desktop client contribution package.
 *
 * The package contributes only a browser-side bundle, but Harness still loads
 * every client package through a host plugin entry. That entry owns the one
 * durable Desktop preference behind the update badge: the release whose
 * reminder the user chose to ignore.
 */
import z from '@deepseek-ai/schemastery'

/** Durable Desktop client preferences. */
const DESKTOP_UI_NAMESPACE = 'desktop-ui'

/**
 * Section shape of {@link DESKTOP_UI_NAMESPACE}. The field stays absent until
 * the user ignores a release, and clearing it restores the reminder.
 */
const DesktopUiSettings = z.object({
  ignoredUpdateVersion: z.string(),
})

/**
 * Register the durable Desktop section when a settings provider is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(DESKTOP_UI_NAMESPACE, DesktopUiSettings)
  })
}

export { apply }

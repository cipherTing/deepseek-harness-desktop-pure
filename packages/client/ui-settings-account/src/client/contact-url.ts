/** Feishu questionnaire context follows the Platform Web ticket fields. */
import type { Config } from '../contact-config.ts'
import type { AccountProfile } from '@deepseek-ai/dsh-deepseek-account/types'

/**
 * Build an external questionnaire URL without authentication credentials.
 * @param config - questionnaire destination and supported source option.
 * @param context - currently available account and browser environment.
 * @returns questionnaire URL with hidden, optionally prefilled context fields.
 */
export function contactUrl(config: Config, context: {
  uid: AccountProfile['id']
  version: string | undefined
  locale: string
  width: number
  height: number
  pixelRatio: number
}): string {
  const url = new URL(config.contactFormUrl)
  const ratio = Number.isFinite(context.pixelRatio) ? context.pixelRatio : 1
  const width = Math.round(context.width * ratio)
  const height = Math.round(context.height * ratio)
  const fields = {
    uid: context.uid, source: config.contactSource, app_version: context.version,
    os_version: undefined, device_brand: undefined, device_model: undefined,
    app_locale: context.locale, screen_resolution: width > 0 && height > 0 ? `${width}x${height}` : undefined,
  }
  for (const [name, value] of Object.entries(fields)) {
    url.searchParams.set(`hide_${name}`, '1')
    url.searchParams.delete(`prefill_${name}`)
    if (value) url.searchParams.set(`prefill_${name}`, value)
  }
  return url.href
}

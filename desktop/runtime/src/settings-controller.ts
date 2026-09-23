import type { Context } from '@deepseek-ai/cordis'
import SettingsController from '@deepseek-ai/dsh-api-settings-controller'
import { systemBridge } from './protocol.ts'

/** Settings Remote owner using Tauri for Desktop-native settings-document opening. */
export default class DesktopSettingsController extends SettingsController {
  constructor(ctx: Context) {
    super(ctx, {
      openTextFile: (path, signal) => systemBridge.request<void>('open-path', { path }, signal),
    })
  }
}

import type { Context } from '@deepseek-ai/cordis'
import SettingsController, {
  type Config,
} from '@deepseek-ai/dsh-api-settings-controller'
import { systemBridge } from './protocol.ts'

/** Settings Remote owner using Tauri for Desktop-native path operations. */
export default class DesktopSettingsController extends SettingsController {
  static Config = SettingsController.Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, config, {
      openPath: (path, signal) => systemBridge.request<void>('open-path', { path }, signal),
      openTextFile: (path, signal) => systemBridge.request<void>('open-path', { path }, signal),
      canOpenPath: () => config.nativeOpen ?? true,
    })
  }
}

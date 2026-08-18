import {
  DirectoryPicker, type DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'
import { systemBridge } from './protocol.ts'

export default class DesktopDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: signal => systemBridge.request<string | null>('pick-directory', {}, signal),
  }

  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}

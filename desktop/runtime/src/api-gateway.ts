import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import ApiProxyService, {
  createApiProxy,
  type ApiProxy,
  type Config,
} from '@deepseek-ai/dsh-host-apiproxy'
import { systemBridge } from './protocol.ts'

export default class DesktopApiProxyService extends Service implements ApiProxy {
  static inject = [
    'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
    'tools', 'userQuestions', 'workspaceRegistry',
  ]

  static Config = ApiProxyService.Config

  readonly sessions: ApiProxy['sessions']
  readonly subagents: ApiProxy['subagents']
  readonly workspace: ApiProxy['workspace']
  readonly host: ApiProxy['host']
  readonly goals: ApiProxy['goals']
  readonly skills: ApiProxy['skills']
  readonly agentPresets: ApiProxy['agentPresets']
  readonly settings: ApiProxy['settings']
  readonly credentials: ApiProxy['credentials']
  readonly llm: ApiProxy['llm']
  readonly events: ApiProxy['events']
  readonly downloads: ApiProxy['downloads']
  readonly respond: ApiProxy['respond']

  constructor(ctx: Context, config: Config) {
    super(ctx, 'apiProxy')
    const defaults: Parameters<typeof createApiProxy>[1] = {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      saveDefaultModelSelection: selection => ctx.agentDefaultModel.saveSelection(selection),
      cwd: process.cwd(),
      openPath: (path, signal) => systemBridge.request<void>('open-path', { path }, signal),
      openTextFile: (path, signal) => systemBridge.request<void>('open-path', { path }, signal),
      canOpenPath: () => config.nativeOpen ?? true,
      ...(config.sessionExportCompressionLevel === undefined
        ? {}
        : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
      ...(config.coldBlankProbeMaxBytes === undefined ? {} : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
    }
    const api = createApiProxy(ctx, defaults)
    this.sessions = api.sessions
    this.subagents = api.subagents
    this.workspace = api.workspace
    this.host = api.host
    this.goals = api.goals
    this.skills = api.skills
    this.agentPresets = api.agentPresets
    this.settings = api.settings
    this.credentials = api.credentials
    this.llm = api.llm
    this.events = api.events
    this.downloads = api.downloads
    this.respond = api.respond.bind(api)
  }
}

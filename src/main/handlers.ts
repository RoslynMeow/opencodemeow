import type { OpencodeClient } from "@opencode-ai/sdk"
import { app, dialog, shell } from "electron"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import type {
  Agent,
  AgentInfo,
  ChatInput,
  Command,
  CommandInput,
  ConfigScope,
  FileDiff,
  LspConfig,
  LspEntry,
  LspViewData,
  McpAuthStart,
  McpConfig,
  McpEntry,
  McpStatus,
  McpViewData,
  Message,
  ModelInfo,
  ModelRef,
  OllamaInfo,
  Part,
  PermissionReply,
  PluginViewData,
  Project,
  ProviderAuthMethod,
  ProviderCatalog,
  ProviderOAuthStart,
  RawConfig,
  RpcName,
  Session,
  SessionEntry,
  SessionStatus,
  SessionUsage,
  Settings,
} from "@shared/types"
import {
  addNpmPlugin,
  createLocalPlugin,
  installOllamaProvider,
  lspRawConfig,
  lspRawEntries,
  mcpRawEntries,
  patchConfig,
  pluginView,
  readRawConfig,
  removeConfigPath,
  removeNpmPlugin,
  setLocalPluginEnabled,
  writeRawConfig,
} from "./config-service"
import { broadcastState, buildAppState } from "./app-state"
import { ensureBackend, restartBackend } from "./backend-manager"
import { clearLogs, getLogs, log } from "./logger"
import {
  addProject,
  getActiveProject,
  getSettings,
  removeProject,
  renameProject,
  rememberAgent,
  rememberModel,
  setActiveProject,
  updateSettings,
} from "./store"
import { configPaths, globalPluginsDir, projectPluginsDir } from "./paths"
import { ensureRuntime, listRuntimeVersions } from "./runtime"
import { getClient, reloadInstance, setActiveDirectory, stopBackend } from "./sidecar"

type Handler = (...args: never[]) => unknown

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function requireProject(): Project {
  const project = getActiveProject()
  if (!project) throw new Error("No active project. Open a project first.")
  return project
}

function requireDirectory(): string {
  return requireProject().path
}

function clientFor(): OpencodeClient {
  return getClient(getActiveProject()?.path ?? app.getPath("home"))
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    const data = record.data
    if (data && typeof data === "object") {
      const message = (data as Record<string, unknown>).message
      if (typeof message === "string" && message) return message
    }
    if (typeof record.message === "string" && record.message) return record.message
    if (typeof record.name === "string" && record.name) return record.name
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

async function call<T>(result: Promise<unknown>): Promise<T> {
  const value = (await result) as { data?: T; error?: unknown }
  if (value && typeof value === "object" && value.error !== undefined && value.error !== null) {
    throw new Error(errorMessage(value.error))
  }
  return value?.data as T
}

function modelFromString(value: unknown): ModelRef | undefined {
  if (typeof value !== "string") return undefined
  const index = value.indexOf("/")
  if (index <= 0 || index >= value.length - 1) return undefined
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

interface RawModel {
  id?: string
  name?: string
  reasoning?: boolean
  attachment?: boolean
  tool_call?: boolean
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number }
}

interface RawProvider {
  id: string
  name: string
  source?: string
  env?: string[]
  models?: Record<string, RawModel>
}

interface RawProviderList {
  all: RawProvider[]
  default?: Record<string, string>
  connected: string[]
}

async function providerCatalog(): Promise<ProviderCatalog> {
  const client = clientFor()
  const list = await call<RawProviderList>(client.provider.list())
  const config = await call<Record<string, unknown>>(client.config.get())
  const connected = new Set(list.connected ?? [])
  const configured = new Set(Object.keys(asRecord(config.provider)))
  const disabled = new Set(Array.isArray(config.disabled_providers) ? (config.disabled_providers as string[]) : [])
  const all = list.all ?? []

  const providers = all
    .filter((provider) => (connected.has(provider.id) || configured.has(provider.id)) && !disabled.has(provider.id))
    .map((provider) => {
      const models: ModelInfo[] = Object.entries(provider.models ?? {}).map(([key, model]) => ({
        id: model.id ?? key,
        name: model.name ?? key,
        providerID: provider.id,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolCall: model.tool_call,
        contextLimit: model.limit?.context,
        outputLimit: model.limit?.output,
        cost:
          typeof model.cost?.input === "number" && typeof model.cost?.output === "number"
            ? { input: model.cost.input, output: model.cost.output }
            : undefined,
      }))
      models.sort((a, b) => a.name.localeCompare(b.name))
      return {
        id: provider.id,
        name: provider.name,
        source: provider.source,
        env: provider.env ?? [],
        connected: connected.has(provider.id),
        models,
      }
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))

  const project = getActiveProject()
  const remembered = project ? getSettings().lastModels[project.id] : undefined
  let defaultModel = modelFromString(config.model) ?? (remembered ? { ...remembered } : undefined)
  if (defaultModel && !providers.some((provider) => provider.id === defaultModel?.providerID)) {
    defaultModel = undefined
  }
  if (!defaultModel) {
    const first = providers.find((provider) => provider.models.length > 0)
    const model = first?.models[0]
    if (first && model) defaultModel = { providerID: first.id, modelID: model.id }
  }

  const available = all
    .map((provider) => ({ id: provider.id, name: provider.name, env: provider.env ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { providers, available, defaultModel, totalProviders: all.length }
}

async function mcpView(): Promise<McpViewData> {
  const client = clientFor()
  const project = getActiveProject()
  let statuses: Record<string, McpStatus> = {}
  try {
    statuses = await call<Record<string, McpStatus>>(client.mcp.status())
  } catch (error) {
    log("mcp", `status unavailable: ${(error as Error).message}`)
  }
  const effective = await call<Record<string, unknown>>(client.config.get()).catch(
    (): Record<string, unknown> => ({}),
  )
  const effectiveMcp = asRecord(effective.mcp)
  const byName = new Map<string, McpEntry>()
  for (const entry of mcpRawEntries("global")) {
    byName.set(entry.name, {
      name: entry.name,
      scope: "global",
      config: entry.config as unknown as McpConfig,
      status: statuses[entry.name],
    })
  }
  if (project) {
    for (const entry of mcpRawEntries("project")) {
      byName.set(entry.name, {
        name: entry.name,
        scope: "project",
        config: entry.config as unknown as McpConfig,
        status: statuses[entry.name],
      })
    }
  }
  for (const [name, raw] of Object.entries(effectiveMcp)) {
    if (byName.has(name)) continue
    byName.set(name, {
      name,
      scope: "inherited",
      config: asRecord(raw) as unknown as McpConfig,
      status: statuses[name],
    })
  }
  const paths = configPaths(project, getSettings().profile)
  return {
    entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    statuses,
    projectFile: paths.projectFile,
    globalFile: paths.globalFile,
  }
}

async function lspView(): Promise<LspViewData> {
  const client = clientFor()
  const project = getActiveProject()
  let statuses: LspViewData["statuses"] = []
  try {
    statuses = await call<LspViewData["statuses"]>(client.lsp.status())
  } catch (error) {
    log("lsp", `status unavailable: ${(error as Error).message}`)
  }
  const effective = await call<Record<string, unknown>>(client.config.get()).catch(
    (): Record<string, unknown> => ({}),
  )
  const globalRaw = lspRawConfig("global")
  const projectRaw = project ? lspRawConfig("project") : undefined
  const raw = projectRaw !== undefined ? projectRaw : globalRaw
  const enabled = raw === true || (!!raw && typeof raw === "object" && !Array.isArray(raw))
  const byName = new Map<string, LspEntry>()
  for (const entry of lspRawEntries("global")) {
    byName.set(entry.name, { name: entry.name, scope: "global", config: entry.config as LspConfig })
  }
  if (project) {
    for (const entry of lspRawEntries("project")) {
      byName.set(entry.name, { name: entry.name, scope: "project", config: entry.config as LspConfig })
    }
  }
  const effectiveLsp = effective.lsp
  if (effectiveLsp && typeof effectiveLsp === "object" && !Array.isArray(effectiveLsp)) {
    for (const [name, config] of Object.entries(effectiveLsp as Record<string, unknown>)) {
      if (byName.has(name)) continue
      byName.set(name, { name, scope: "inherited", config: asRecord(config) as LspConfig })
    }
  }
  const paths = configPaths(project, getSettings().profile)
  return {
    enabled,
    entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    statuses,
    projectFile: paths.projectFile,
    globalFile: paths.globalFile,
  }
}

async function applyConfigChange(): Promise<void> {
  try {
    await reloadInstance(getActiveProject()?.path ?? app.getPath("home"))
  } catch (error) {
    log("config", `reload failed: ${(error as Error).message}`)
  }
  broadcastState()
}

async function applyPluginChange(): Promise<void> {
  try {
    await restartBackend(false)
  } catch (error) {
    log("plugins", `backend restart failed: ${(error as Error).message}`)
  }
  broadcastState()
}

async function ollamaDetect(input?: string): Promise<OllamaInfo> {
  let baseUrl = input?.trim() || "http://127.0.0.1:11434"
  baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/api$/, "")
  try {
    const [tagsResponse, versionResponse] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
    ])
    if (!tagsResponse.ok) {
      return { reachable: false, baseUrl, models: [], error: `HTTP ${tagsResponse.status}` }
    }
    const tags = (await tagsResponse.json()) as {
      models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; quantization_level?: string } }>
    }
    let version: string | undefined
    if (versionResponse?.ok) {
      const body = (await versionResponse.json()) as { version?: string }
      version = body.version
    }
    const models = (tags.models ?? [])
      .filter((model) => typeof model.name === "string")
      .map((model) => ({
        name: model.name as string,
        size: model.size,
        parameterSize: model.details?.parameter_size,
        quantization: model.details?.quantization_level,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { reachable: true, baseUrl, version, models }
  } catch (error) {
    return { reachable: false, baseUrl, models: [], error: (error as Error).message }
  }
}

export const handlers: Record<RpcName, Handler> = {
  "app.state": () => buildAppState(),

  "app.updateSettings": async (patch: Partial<Settings>) => {
    const before = getSettings()
    const after = updateSettings(patch)
    if (before.profile !== after.profile) {
      log("app", `profile switched: ${before.profile} -> ${after.profile}`)
      await stopBackend()
      await ensureBackend(false)
    } else if (before.runtimeVersion !== after.runtimeVersion || before.autoDownload !== after.autoDownload) {
      await restartBackend(false)
    } else {
      broadcastState()
    }
    return buildAppState()
  },

  "app.restartBackend": async () => {
    await restartBackend(false)
    return buildAppState()
  },

  "app.reloadConfig": async () => reloadInstance(requireDirectory()),

  "app.pickProject": async () => {
    const result = await dialog.showOpenDialog({
      title: "Open project folder",
      properties: ["openDirectory", "createDirectory"],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  },

  "app.openPath": async (target: string) => {
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  },

  "app.showItem": (target: string) => {
    shell.showItemInFolder(target)
  },

  "app.openExternal": async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs can be opened")
    await shell.openExternal(url)
  },

  "app.logs": () => getLogs(),
  "app.clearLogs": () => {
    clearLogs()
    broadcastState()
  },

  "runtime.ensure": async (force?: boolean) => {
    const settings = getSettings()
    const status = await ensureRuntime(settings.runtimeVersion, settings.autoDownload, Boolean(force))
    if (status.state === "ready") {
      await restartBackend(false)
    } else {
      broadcastState()
    }
    return buildAppState()
  },

  "runtime.versions": () => listRuntimeVersions(),

  "project.add": async (inputPath: string) => {
    const path = resolve(inputPath)
    if (!existsSync(path)) throw new Error(`Folder does not exist: ${path}`)
    if (!statSync(path).isDirectory()) throw new Error(`Not a folder: ${path}`)
    const project = addProject(path)
    setActiveProject(project.id)
    setActiveDirectory(project.path)
    await ensureBackend(false).catch((error) => log("app", `backend after add project: ${(error as Error).message}`))
    setActiveDirectory(project.path)
    return broadcastState()
  },

  "project.remove": async (id: string) => {
    removeProject(id)
    const active = getActiveProject()
    setActiveDirectory(active?.path ?? null)
    return broadcastState()
  },

  "project.activate": async (id: string) => {
    setActiveProject(id)
    const project = getActiveProject()
    setActiveDirectory(project?.path ?? null)
    await ensureBackend(false).catch((error) => log("app", `backend after activate: ${(error as Error).message}`))
    setActiveDirectory(project?.path ?? null)
    return broadcastState()
  },

  "project.rename": (id: string, name: string) => {
    renameProject(id, name)
    return broadcastState()
  },

  "provider.catalog": () => providerCatalog(),

  "provider.agents": async () => {
    const agents = await call<Agent[]>(clientFor().app.agents())
    return (agents ?? []).map<AgentInfo>((agent) => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      builtin: agent.builtIn,
      model: agent.model,
    }))
  },

  "provider.authMethods": () => call<Record<string, ProviderAuthMethod[]>>(clientFor().provider.auth()),

  "provider.setApiKey": async (id: string, key: string) => {
    const result = await call<boolean>(clientFor().auth.set({ path: { id }, body: { type: "api", key } }))
    await applyConfigChange()
    return result === true
  },

  "provider.oauthAuthorize": async (id: string, method: number) => {
    const result = await call<ProviderOAuthStart>(
      clientFor().provider.oauth.authorize({ path: { id }, body: { method } }),
    )
    if (result?.url) await shell.openExternal(result.url)
    return result
  },

  "provider.oauthCallback": async (id: string, method: number, code?: string) => {
    const result = await call<boolean>(
      clientFor().provider.oauth.callback({ path: { id }, body: { method, code } }),
    )
    await applyConfigChange()
    return result === true
  },

  "provider.ollamaDetect": (baseUrl?: string) => ollamaDetect(baseUrl),

  "provider.ollamaInstall": async (scope: ConfigScope, baseUrl: string, models: string[]) => {
    const result = installOllamaProvider(scope, baseUrl, models)
    await applyConfigChange()
    return result
  },

  "session.list": async () => {
    const sessions = await call<Session[]>(clientFor().session.list())
    return (sessions ?? []).sort((a, b) => b.time.updated - a.time.updated)
  },

  "session.create": async (title?: string) => {
    return call<Session>(clientFor().session.create({ body: { title: title || "New chat" } }))
  },

  "session.delete": (id: string) => call<boolean>(clientFor().session.delete({ path: { id } })),

  "session.update": (id: string, title: string) =>
    call<Session>(clientFor().session.update({ path: { id }, body: { title } })),

  "session.messages": async (id: string) => {
    const messages = await call<Array<{ info: Message; parts: Part[] }>>(
      clientFor().session.messages({ path: { id }, query: { limit: 300 } }),
    )
    return (messages ?? []).map<SessionEntry>((entry) => ({ info: entry.info, parts: entry.parts ?? [] }))
  },

  "session.diff": (id: string) => call<FileDiff[]>(clientFor().session.diff({ path: { id } })),

  "session.usage": async (ids: string[]) => {
    const client = clientFor()
    const result: Record<string, SessionUsage> = {}
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const empty: SessionUsage = {
          sessionID: id,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          messages: 0,
          completed: false,
        }
        try {
          const messages = await call<Array<{ info: Message; parts: Part[] }>>(
            client.session.messages({ path: { id } }),
          )
          const usage: SessionUsage = { ...empty, tokens: { ...empty.tokens } }
          for (const entry of messages ?? []) {
            const info = entry.info
            if (info.role !== "assistant") continue
            usage.cost += info.cost ?? 0
            usage.tokens.input += info.tokens?.input ?? 0
            usage.tokens.output += info.tokens?.output ?? 0
            usage.tokens.reasoning += info.tokens?.reasoning ?? 0
            usage.tokens.cacheRead += info.tokens?.cache?.read ?? 0
            usage.tokens.cacheWrite += info.tokens?.cache?.write ?? 0
            if (info.mode) usage.agent = info.mode
            if (info.providerID && info.modelID) {
              usage.model = { providerID: info.providerID, modelID: info.modelID }
            }
            usage.completed = Boolean(info.time.completed)
          }
          usage.messages = messages?.length ?? 0
          result[id] = usage
        } catch (error) {
          log("session", `usage for ${id} failed: ${(error as Error).message}`)
          result[id] = empty
        }
      }),
    )
    return result
  },

  "session.abort": (id: string) => call<boolean>(clientFor().session.abort({ path: { id } })),

  "session.status": () => call<Record<string, SessionStatus>>(clientFor().session.status()),

  "chat.send": async (input: ChatInput) => {
    if (!input.text?.trim()) throw new Error("Message is empty")
    const project = requireProject()
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text: input.text }],
    }
    if (input.providerID && input.modelID) {
      body.model = { providerID: input.providerID, modelID: input.modelID }
      rememberModel(project.id, input.providerID, input.modelID)
    }
    if (input.agent) {
      body.agent = input.agent
      rememberAgent(project.id, input.agent)
    }
    await call<unknown>(
      clientFor().session.promptAsync({ path: { id: input.sessionId }, body: body as never }),
    )
  },

  "chat.command": async (input: CommandInput) => {
    const project = requireProject()
    const body: Record<string, unknown> = {
      command: input.command,
      arguments: input.arguments,
    }
    if (input.providerID && input.modelID) {
      body.model = { providerID: input.providerID, modelID: input.modelID }
      rememberModel(project.id, input.providerID, input.modelID)
    }
    if (input.agent) body.agent = input.agent
    await call<unknown>(
      clientFor().session.command({ path: { id: input.sessionId }, body: body as never }),
    )
  },

  "command.list": () => call<Command[]>(clientFor().command.list()),

  "permission.reply": async (input: PermissionReply) => {
    const result = await call<boolean>(
      clientFor().postSessionIdPermissionsPermissionId({
        path: { id: input.sessionId, permissionID: input.permissionId },
        body: { response: input.response },
      }),
    )
    return result === true
  },

  "config.read": (scope: ConfigScope) => readRawConfig(scope),

  "config.write": async (scope: ConfigScope, content: string) => {
    const result = writeRawConfig(scope, content)
    await applyConfigChange()
    return result
  },

  "config.patch": async (scope: ConfigScope, path: (string | number)[], value: unknown) => {
    const result = patchConfig(scope, path, value)
    await applyConfigChange()
    return result
  },

  "config.remove": async (scope: ConfigScope, path: (string | number)[]) => {
    const result = removeConfigPath(scope, path)
    await applyConfigChange()
    return result
  },

  "config.effective": () => call<Record<string, unknown>>(clientFor().config.get()),

  "config.paths": () => configPaths(getActiveProject(), getSettings().profile),

  "mcp.view": () => mcpView(),

  "mcp.save": async (scope: ConfigScope, name: string, config: McpConfig) => {
    const serverName = name.trim()
    if (!serverName) throw new Error("MCP server name is required")
    patchConfig(scope, ["mcp", serverName], config)
    await applyConfigChange()
    return mcpView()
  },

  "mcp.remove": async (scope: ConfigScope, name: string) => {
    removeConfigPath(scope, ["mcp", name])
    await applyConfigChange()
    return mcpView()
  },

  "mcp.toggle": async (scope: ConfigScope, name: string, enabled: boolean) => {
    patchConfig(scope, ["mcp", name, "enabled"], enabled)
    await applyConfigChange()
    return mcpView()
  },

  "mcp.connect": (name: string) => call<boolean>(clientFor().mcp.connect({ path: { name } })),

  "mcp.disconnect": (name: string) => call<boolean>(clientFor().mcp.disconnect({ path: { name } })),

  "mcp.authStart": async (name: string) => {
    const result = await call<{ authorizationUrl: string }>(
      clientFor().mcp.auth.start({ path: { name } }),
    )
    if (result?.authorizationUrl) await shell.openExternal(result.authorizationUrl)
    const start: McpAuthStart = {
      url: result?.authorizationUrl ?? "",
      instructions: "Complete authorization in your browser, then return here.",
    }
    return start
  },

  "mcp.authCallback": async (name: string, code?: string) => {
    const result = await call<boolean>(
      clientFor().mcp.auth.callback({ path: { name }, body: { code: code ?? "" } }),
    )
    return result === true
  },

  "mcp.authRemove": (name: string) => call<boolean>(clientFor().mcp.auth.remove({ path: { name } })),

  "lsp.view": () => lspView(),

  "lsp.setEnabled": async (scope: ConfigScope, enabled: boolean) => {
    patchConfig(scope, ["lsp"], Boolean(enabled))
    await applyConfigChange()
    return lspView()
  },

  "lsp.save": async (scope: ConfigScope, name: string, config: LspConfig) => {
    const serverName = name.trim()
    if (!serverName) throw new Error("LSP server name is required")
    if (readRawConfig(scope).parsed.lsp === true) {
      patchConfig(scope, ["lsp"], {})
    }
    patchConfig(scope, ["lsp", serverName], config)
    await applyConfigChange()
    return lspView()
  },

  "lsp.remove": async (scope: ConfigScope, name: string) => {
    const raw = readRawConfig(scope).parsed.lsp
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      removeConfigPath(scope, ["lsp", name])
      await applyConfigChange()
    }
    return lspView()
  },

  "lsp.toggle": async (scope: ConfigScope, name: string, disabled: boolean) => {
    const raw = readRawConfig(scope).parsed.lsp
    if (raw === true) {
      patchConfig(scope, ["lsp"], {})
    }
    const normalized = readRawConfig(scope).parsed.lsp
    const entries =
      normalized && typeof normalized === "object" && !Array.isArray(normalized)
        ? (normalized as Record<string, unknown>)
        : {}
    if (!disabled && !(name in entries)) {
      return lspView()
    }
    patchConfig(scope, ["lsp", name, "disabled"], Boolean(disabled))
    await applyConfigChange()
    return lspView()
  },

  "plugin.view": () => pluginView(),

  "plugin.add": async (scope: ConfigScope, name: string) => {
    addNpmPlugin(scope, name)
    await applyPluginChange()
    return pluginView()
  },

  "plugin.remove": async (scope: ConfigScope, name: string) => {
    removeNpmPlugin(scope, name)
    await applyPluginChange()
    return pluginView()
  },

  "plugin.setLocalEnabled": async (scope: ConfigScope, fileName: string, enabled: boolean) => {
    setLocalPluginEnabled(scope, fileName, Boolean(enabled))
    await applyPluginChange()
    return pluginView()
  },

  "plugin.openFolder": async (scope: ConfigScope) => {
    const dir = scope === "project" ? projectPluginsDir(requireProject()) : globalPluginsDir(getSettings().profile)
    mkdirSync(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
  },

  "plugin.createLocal": async (scope: ConfigScope, fileName: string, content: string) => {
    createLocalPlugin(scope, fileName, content)
    await applyPluginChange()
    return pluginView()
  },
}

export async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const handler = (handlers as Record<string, Handler | undefined>)[method]
  if (!handler) throw new Error(`Unknown RPC method: ${method}`)
  return await handler(...(args as never[]))
}

import { app } from "electron"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { log } from "./logger"
import { displayProjectName } from "./paths"
import { DEFAULT_RUNTIME_VERSION, type Project, type Settings } from "@shared/types"

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

interface PersistedState {
  settings: Settings
  projects: Project[]
  activeProjectId: string | null
  window?: WindowState
}

let state: PersistedState | null = null
let stateFile = ""

const defaultSettings: Settings = {
  profile: "global",
  runtimeVersion: DEFAULT_RUNTIME_VERSION,
  autoDownload: true,
  theme: "dark",
  language: "system",
  lastModels: {},
  lastAgents: {},
}

export function initStore(): void {
  stateFile = join(app.getPath("userData"), "studio-state.json")
  let loaded: Partial<PersistedState> = {}
  try {
    if (existsSync(stateFile)) {
      loaded = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<PersistedState>
    }
  } catch (error) {
    log("store", `failed to read state: ${(error as Error).message}`)
  }
  const next: PersistedState = {
    settings: { ...defaultSettings, ...(loaded.settings ?? {}) },
    projects: Array.isArray(loaded.projects) ? loaded.projects : [],
    activeProjectId: loaded.activeProjectId ?? null,
    window: loaded.window,
  }
  if (next.activeProjectId && !next.projects.some((project) => project.id === next.activeProjectId)) {
    next.activeProjectId = next.projects[0]?.id ?? null
  }
  state = next
  log("store", `loaded ${next.projects.length} project(s) from ${stateFile}`)
}

function ensureState(): PersistedState {
  if (!state) initStore()
  return state as PersistedState
}

export function saveStore(): void {
  const current = ensureState()
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    const temp = `${stateFile}.tmp`
    writeFileSync(temp, JSON.stringify(current, null, 2), "utf8")
    renameSync(temp, stateFile)
  } catch (error) {
    log("store", `failed to save state: ${(error as Error).message}`)
  }
}

export function getSettings(): Settings {
  return { ...ensureState().settings }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = ensureState()
  current.settings = { ...current.settings, ...patch, lastModels: { ...current.settings.lastModels, ...(patch.lastModels ?? {}) }, lastAgents: { ...current.settings.lastAgents, ...(patch.lastAgents ?? {}) } }
  saveStore()
  return getSettings()
}

export function getProjects(): Project[] {
  return [...ensureState().projects]
}

export function getActiveProject(): Project | null {
  const current = ensureState()
  return current.projects.find((project) => project.id === current.activeProjectId) ?? null
}

export function getActiveProjectId(): string | null {
  return ensureState().activeProjectId
}

export function setActiveProject(id: string | null): void {
  const current = ensureState()
  if (id && !current.projects.some((project) => project.id === id)) return
  current.activeProjectId = id
  if (id) {
    const project = current.projects.find((candidate) => candidate.id === id)
    if (project) project.lastOpenedAt = Date.now()
    current.settings.lastProjectId = id
  }
  saveStore()
}

export function addProject(inputPath: string): Project {
  const current = ensureState()
  const path = resolve(inputPath)
  const existing = current.projects.find((project) => samePath(project.path, path))
  if (existing) return existing
  const project: Project = {
    id: randomUUID(),
    name: displayProjectName(path),
    path,
    addedAt: Date.now(),
  }
  current.projects.push(project)
  if (!current.activeProjectId) current.activeProjectId = project.id
  current.settings.lastProjectId = current.activeProjectId ?? undefined
  saveStore()
  log("store", `added project ${project.name} (${project.path})`)
  return project
}

export function removeProject(id: string): void {
  const current = ensureState()
  const project = current.projects.find((candidate) => candidate.id === id)
  current.projects = current.projects.filter((candidate) => candidate.id !== id)
  delete current.settings.lastModels[id]
  delete current.settings.lastAgents[id]
  if (current.activeProjectId === id) {
    current.activeProjectId = current.projects[0]?.id ?? null
  }
  saveStore()
  if (project) log("store", `removed project ${project.name}`)
}

export function renameProject(id: string, name: string): void {
  const current = ensureState()
  const project = current.projects.find((candidate) => candidate.id === id)
  if (!project) return
  const trimmed = name.trim()
  if (trimmed) project.name = trimmed
  saveStore()
}

export function rememberModel(projectId: string, providerID: string, modelID: string): void {
  const current = ensureState()
  current.settings.lastModels[projectId] = { providerID, modelID }
  current.settings.lastProjectId = current.activeProjectId ?? undefined
  saveStore()
}

export function rememberAgent(projectId: string, agent: string): void {
  const current = ensureState()
  current.settings.lastAgents[projectId] = agent
  saveStore()
}

export function getWindowState(): WindowState | undefined {
  return ensureState().window
}

export function saveWindowState(window: WindowState): void {
  const current = ensureState()
  current.window = window
  saveStore()
}

function samePath(a: string, b: string): boolean {
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase()
  return a === b
}

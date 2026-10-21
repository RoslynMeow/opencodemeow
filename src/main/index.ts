import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron"
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BackendStatus, RuntimeStatus, StudioEvent } from "@shared/types"
import { initLogger, log, setLogHook } from "./logger"
import { getWindowState, initStore, saveWindowState, type WindowState } from "./store"
import { setRuntimeHook } from "./runtime"
import { configureSidecar, getBackendStatus, setActiveDirectory, stopBackendImmediate } from "./sidecar"
import { dispatch } from "./handlers"
import { broadcastState, buildAppState } from "./app-state"
import { emitEvent, setEventSink } from "./events"
import { ensureBackend } from "./backend-manager"
import { addProject, getActiveProject, setActiveProject, updateSettings } from "./store"
import { projectConfigFile } from "./paths"

const baseDir = fileURLToPath(new URL(".", import.meta.url))
let mainWindow: BrowserWindow | null = null

function migrateLegacyUserData(): void {
  const current = app.getPath("userData")
  const legacy = join(app.getPath("appData"), "opencode-studio")
  if (current === legacy || !existsSync(legacy)) return
  mkdirSync(current, { recursive: true })
  for (const name of ["runtime", "profiles"]) {
    const source = join(legacy, name)
    const target = join(current, name)
    if (existsSync(source) && !existsSync(target)) {
      cpSync(source, target, { recursive: true })
    }
  }
  const legacyState = join(legacy, "studio-state.json")
  const currentState = join(current, "studio-state.json")
  if (existsSync(legacyState) && !existsSync(currentState)) {
    copyFileSync(legacyState, currentState)
  }
}

function send(event: StudioEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("studio:event", event)
  }
}

function preloadPath(): string {
  for (const name of ["index.mjs", "index.js"]) {
    const candidate = join(baseDir, "../preload", name)
    if (existsSync(candidate)) return candidate
  }
  return join(baseDir, "../preload/index.mjs")
}

function restoredBounds(saved?: WindowState): Electron.Rectangle | { width: number; height: number } {
  if (!saved) return { width: 1440, height: 920 }
  const width = Math.max(1040, saved.width)
  const height = Math.max(680, saved.height)
  const visible =
    saved.x !== undefined &&
    saved.y !== undefined &&
    screen.getAllDisplays().some((display) => {
      const area = display.workArea
      return (
        saved.x! < area.x + area.width - 80 &&
        saved.x! + width > area.x + 80 &&
        saved.y! < area.y + area.height - 80 &&
        saved.y! + height > area.y + 80
      )
    })
  if (!visible) return { width, height }
  return { x: saved.x, y: saved.y, width, height }
}

function createWindow(): void {
  const savedWindow = getWindowState()
  const bounds = restoredBounds(savedWindow)
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#0a0b0f",
    title: "OpenCode MeowStudio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  let saveTimer: NodeJS.Timeout | null = null
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const normal = mainWindow.getNormalBounds()
    saveWindowState({
      x: normal.x,
      y: normal.y,
      width: normal.width,
      height: normal.height,
      maximized: mainWindow.isMaximized(),
    })
  }
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 350)
  }

  mainWindow.once("ready-to-show", () => {
    if (savedWindow?.maximized) mainWindow?.maximize()
    mainWindow?.show()
  })
  mainWindow.on("resize", scheduleSave)
  mainWindow.on("move", scheduleSave)
  mainWindow.on("maximize", scheduleSave)
  mainWindow.on("unmaximize", scheduleSave)
  mainWindow.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistBounds()
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(baseDir, "../renderer/index.html"))
  }
}

function installMenu(): void {
  const isMac = process.platform === "darwin"
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { role: isMac ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "OpenCode documentation",
          click: () => void shell.openExternal("https://opencode.ai/docs"),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function wireEvents(): void {
  setEventSink(send)
  setLogHook((line) => send({ type: "log", line }))
  setRuntimeHook((status: RuntimeStatus) => send({ type: "runtime", status }))
  configureSidecar({
    onStatus: (status: BackendStatus) => {
      send({ type: "backend", status })
      if (status.state === "error" && status.error) {
        send({ type: "toast", level: "error", message: status.error })
      }
    },
    onEvent: (payload) => send({ type: "opencode", payload }),
  })
}

function registerIpc(): void {
  ipcMain.handle("studio:rpc", async (_event, method: string, args: unknown[]) => {
    try {
      return await dispatch(method, args)
    } catch (error) {
      log("rpc", `${method} failed: ${(error as Error).stack ?? (error as Error).message}`)
      throw new Error((error as Error).message)
    }
  })
}

async function runSmoke(): Promise<void> {
  const smokeProject = process.env.STUDIO_SMOKE_PROJECT
  if (smokeProject) {
    const project = addProject(smokeProject)
    setActiveProject(project.id)
  }
  const started = Date.now()
  let exitCode = 0
  const results: Record<string, unknown> = {}
  try {
    log("smoke", "starting backend")
    await ensureBackend(false)
    results.state = buildAppState()
    results.projectConfig = getActiveProject() ? projectConfigFile(getActiveProject()!) : null
    log("smoke", "provider catalog")
    results.providers = await dispatch("provider.catalog", [])
    results.agents = await dispatch("provider.agents", [])
    results.sessions = await dispatch("session.list", [])
    if (process.env.STUDIO_SMOKE_PROMPT === "1") {
      log("smoke", "prompt round-trip")
      const catalog = results.providers as {
        defaultModel?: { providerID: string; modelID: string }
      }
      const events: unknown[] = []
      configureSidecar({
        onStatus: () => undefined,
        onEvent: (payload) => events.push(payload.event),
      })
      const session = (await dispatch("session.create", ["Prompt smoke"])) as { id: string }
      const model = catalog.defaultModel
      await dispatch("chat.send", [
        {
          sessionId: session.id,
          text: "Reply with exactly: OK",
          providerID: model?.providerID,
          modelID: model?.modelID,
        },
      ])
      const deadline = Date.now() + 90_000
      const promptStart = Date.now()
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const statuses = (await dispatch("session.status", [])) as Record<string, { type: string }>
        if (statuses[session.id]?.type === "idle" && Date.now() - promptStart > 1500) break
      }
      const messages = (await dispatch("session.messages", [session.id])) as Array<{
        info: { role: string }
        parts: Array<{ type: string; text?: string }>
      }>
      results.promptMessages = messages.map((message) => ({
        role: message.info.role,
        text: message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      }))
      results.promptEventCount = events.length
      results.promptEventTypes = [
        ...new Set(
          events.map((entry) => {
            const record = entry as { type?: string }
            return record.type ?? "unknown"
          }),
        ),
      ]
      await dispatch("session.delete", [session.id])
    }
    results.mcp = await dispatch("mcp.view", [])
    results.lsp = await dispatch("lsp.view", [])
    results.plugins = await dispatch("plugin.view", [])
    results.config = await dispatch("config.effective", [])
    results.ollama = await dispatch("provider.ollamaDetect", [])
    log("smoke", "session lifecycle")
    const session = (await dispatch("session.create", ["Smoke session"])) as { id: string }
    results.session = session
    results.sessionMessages = await dispatch("session.messages", [session.id])
    results.sessionDiff = await dispatch("session.diff", [session.id])
    await dispatch("session.delete", [session.id])
    log("smoke", "config mutations")
    await dispatch("config.patch", ["project", ["lsp"], false])
    results.lspDisabled = await dispatch("lsp.view", [])
    await dispatch("config.patch", ["project", ["lsp"], true])
    await dispatch("lsp.toggle", ["project", "rust", true])
    results.lspToggle = await dispatch("lsp.view", [])
    await dispatch("lsp.remove", ["project", "rust"])
    await dispatch("mcp.save", [
      "project",
      "smoke-disabled",
      { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-everything"], enabled: false },
    ])
    results.mcpAfterSave = await dispatch("mcp.view", [])
    await dispatch("mcp.remove", ["project", "smoke-disabled"])
    log("smoke", "ollama install")
    const ollama = results.ollama as { models?: Array<{ name: string }>; reachable?: boolean; baseUrl?: string }
    const smokeModel = ollama.models?.[0]?.name ?? "smoke-model:latest"
    await dispatch("provider.ollamaInstall", ["project", ollama.baseUrl ?? "http://127.0.0.1:11434", [smokeModel]])
    results.catalogAfterOllama = await dispatch("provider.catalog", [])
    results.configAfterOllama = await dispatch("config.read", ["project"])
    await dispatch("config.remove", ["project", ["provider", "ollama-local"]])
    log("smoke", "plugin lifecycle")
    const pluginFile = `smoke-plugin-${Date.now()}.ts`
    await dispatch("plugin.createLocal", [
      "project",
      pluginFile,
      'export const SmokePlugin = async () => ({ event: async () => {} })\n',
    ])
    results.pluginsAfterCreate = await dispatch("plugin.view", [])
    await dispatch("plugin.setLocalEnabled", ["project", pluginFile, false])
    results.pluginsAfterToggle = await dispatch("plugin.view", [])
    try {
      const { rmSync } = await import("node:fs")
      rmSync(join(smokeProject ?? "", ".opencode", "plugins", `${pluginFile}.disabled`), { force: true })
    } catch {
      // ignore cleanup failure
    }
    results.elapsedMs = Date.now() - started
    if (process.env.STUDIO_SMOKE_PROFILE === "1") {
      log("smoke", "isolated profile")
      await dispatch("app.updateSettings", [{ profile: "isolated" }])
      results.isolatedState = buildAppState()
      results.isolatedCatalog = await dispatch("provider.catalog", [])
      await dispatch("app.updateSettings", [{ profile: "global" }])
      results.restoredState = buildAppState()
    }
    if (process.env.STUDIO_SMOKE_COORDINATOR === "1") {
      log("smoke", "coordinator agent")
      await dispatch("config.patch", [
        "project",
        ["agent", "coordinator"],
        {
          description: "Breaks work into independent subtasks and delegates them to subagents in parallel.",
          mode: "primary",
          prompt: "Break this task into independent subtasks and delegate them to subagents.",
        },
      ])
      results.coordinatorAgents = await dispatch("provider.agents", [])
      await dispatch("config.remove", ["project", ["agent", "coordinator"]])
    }
    log("smoke", `ok in ${results.elapsedMs}ms`)
  } catch (error) {
    exitCode = 1
    results.error = (error as Error).stack ?? (error as Error).message
    log("smoke", `failed: ${(error as Error).message}`)
  }
  const output = JSON.stringify(results)
  try {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(app.getPath("userData"), "smoke-result.json"), output, "utf8")
  } catch {
    // ignore
  }
  process.stdout.write(`SMOKE_RESULT ${output}\n`)
  stopBackendImmediate()
  app.exit(exitCode)
}

async function captureScreenshot(): Promise<void> {
  const target = process.env.STUDIO_SCREENSHOT
  if (!target) return
  await new Promise((resolve) => setTimeout(resolve, 5000))
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { writeFileSync } = await import("node:fs")
  const initial = await mainWindow.webContents.capturePage()
  writeFileSync(`${target}-initial.png`, initial.toPNG())

  if (process.env.STUDIO_DEMO_TREE === "1") {
    try {
      await ensureBackend(false)
      const sessions = (await dispatch("session.list", [])) as Array<{ id: string; parentID?: string }>
      const parents = new Set(sessions.flatMap((session) => (session.parentID ? [session.parentID] : [])))
      const root = sessions.find((session) => !session.parentID && parents.has(session.id)) ?? sessions.find((session) => !session.parentID)
      const state = buildAppState()
      if (root && state.activeProjectId) {
        await mainWindow.webContents.executeJavaScript(
          `(() => {
            localStorage.setItem("meowstudio:view", "chat");
            localStorage.setItem("meowstudio:lastSession:${state.activeProjectId}", ${JSON.stringify(root.id)});
            localStorage.setItem("meowstudio:treeOpen", "1");
            location.reload();
            return true
          })()`,
        )
        await new Promise((resolve) => setTimeout(resolve, 6500))
        const image = await mainWindow.webContents.capturePage()
        writeFileSync(`${target}-tree.png`, image.toPNG())
        const openedDetail = await mainWindow.webContents.executeJavaScript(
          `(() => {
            const nodes = [...document.querySelectorAll("aside [data-session-node]")];
            if (nodes[1]) { nodes[1].click(); return true }
            return false
          })()`,
        )
        if (openedDetail) {
          await new Promise((resolve) => setTimeout(resolve, 900))
          const detail = await mainWindow.webContents.capturePage()
          writeFileSync(`${target}-tree-detail.png`, detail.toPNG())
        }
        log("app", "screenshot tree written")
      }
    } catch (error) {
      log("app", `tree demo failed: ${(error as Error).message}`)
    }
    stopBackendImmediate()
    app.exit(0)
    return
  }

  if (process.env.STUDIO_DEMO_PROMPT === "1") {
    try {
      await ensureBackend(false)
      const catalog = (await dispatch("provider.catalog", [])) as {
        defaultModel?: { providerID: string; modelID: string }
      }
      const session = (await dispatch("session.create", ["Welcome to OpenCode MeowStudio"])) as { id: string }
      const model = catalog.defaultModel
      log("app", `demo prompt using ${model?.providerID}/${model?.modelID}`)
      await dispatch("chat.send", [
        {
          sessionId: session.id,
          text: "Respond with a friendly two sentence greeting, then a three-item bullet list of things you can help with. Keep it under 70 words.",
          providerID: model?.providerID,
          modelID: model?.modelID,
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 12_000))
      mainWindow.webContents.reload()
      await new Promise((resolve) => setTimeout(resolve, 5000))
    } catch (error) {
      log("app", `demo prompt failed: ${(error as Error).message}`)
    }
  }

  if (process.env.STUDIO_DEMO_LIVE === "1") {
    try {
      await mainWindow.webContents.executeJavaScript(
        `(() => { const b = [...document.querySelectorAll("aside button")].find((n) => n.textContent?.trim().startsWith("New chat")); b?.click(); return Boolean(b) })()`,
      )
      await new Promise((resolve) => setTimeout(resolve, 1600))
      await mainWindow.webContents.executeJavaScript(
        `(() => {
          const textarea = document.querySelector("textarea");
          if (!textarea) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(textarea, "Write a numbered list of 12 short tips for writing clean TypeScript. Do not use tools. Keep each tip under 12 words.");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          setTimeout(() => {
            const send = [...document.querySelectorAll("button")].find((button) => button.title === "Send");
            send?.click();
          }, 250);
          return true;
        })()`,
      )
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const early = await mainWindow.webContents.capturePage()
      writeFileSync(`${target}-live-early.png`, early.toPNG())
      await new Promise((resolve) => setTimeout(resolve, 32_000))
      const late = await mainWindow.webContents.capturePage()
      writeFileSync(`${target}-live-late.png`, late.toPNG())
      log("app", "live screenshots written")
    } catch (error) {
      log("app", `live demo failed: ${(error as Error).message}`)
    }
    stopBackendImmediate()
    app.exit(0)
    return
  }

  const views = ["chat", "projects", "models", "mcp", "lsp", "plugins", "settings"]
  for (const view of views) {
    const clicked = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const button = document.querySelector('aside [data-view="${view}"]');
        if (button) { button.click(); return true }
        return false
      })()`,
    )
    if (clicked) {
      await new Promise((resolve) => setTimeout(resolve, 1400))
      const image = await mainWindow.webContents.capturePage()
      writeFileSync(`${target}-${view}.png`, image.toPNG())
      log("app", `screenshot ${view} written`)
    }
    if (process.env.STUDIO_DEMO_MARKET === "1" && (view === "mcp" || view === "lsp")) {
      const clickedMarket = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const button = document.querySelector('main [data-tab="market"]');
          if (button) { button.click(); return true }
          return false
        })()`,
      )
      if (clickedMarket) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const image = await mainWindow.webContents.capturePage()
        writeFileSync(`${target}-${view}-market.png`, image.toPNG())
        log("app", `screenshot ${view}-market written`)
      }
    }
  }

  if (process.env.STUDIO_DEMO_SWITCH === "1") {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
        document.querySelector('aside [data-view="settings"]')?.click();
        setTimeout(() => {
          document.querySelector('[data-language-option="zh-CN"]')?.click();
          document.querySelector('[data-theme-option="light"]')?.click();
        }, 500);
        return true
      })()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const image = await mainWindow.webContents.capturePage()
    writeFileSync(`${target}-switched.png`, image.toPNG())
    log("app", "screenshot switched written")
  }

  stopBackendImmediate()
  app.exit(0)
}

async function boot(): Promise<void> {
  migrateLegacyUserData()
  initLogger()
  initStore()
  wireEvents()
  registerIpc()
  installMenu()

  if (process.env.STUDIO_SMOKE === "1") {
    await runSmoke()
    return
  }

  const demoProject = process.env.STUDIO_DEMO_PROJECT
  if (demoProject) {
    const project = addProject(demoProject)
    setActiveProject(project.id)
  }
  const demoLanguage = process.env.STUDIO_DEMO_LANG
  if (demoLanguage === "en" || demoLanguage === "zh-CN") {
    updateSettings({ language: demoLanguage })
  }
  const demoTheme = process.env.STUDIO_DEMO_THEME
  if (demoTheme === "dark" || demoTheme === "light" || demoTheme === "system") {
    updateSettings({ theme: demoTheme })
  }

  createWindow()
  const project = getActiveProject()
  setActiveDirectory(project?.path ?? null)
  void captureScreenshot()
  void ensureBackend(false)
    .then(() => log("app", "backend ready"))
    .catch((error) => {
      log("app", `backend failed: ${(error as Error).message}`)
      send({ type: "toast", level: "error", message: (error as Error).message })
      broadcastState()
    })
}

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(boot).catch((error) => {
    console.error(error)
    app.exit(1)
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && process.env.STUDIO_SMOKE !== "1") createWindow()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", () => {
    stopBackendImmediate()
  })
}




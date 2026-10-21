import { useEffect } from "react"
import { ChatView } from "./components/ChatView"
import { PermissionDialog } from "./components/PermissionDialog"
import { Sidebar } from "./components/Sidebar"
import { Toasts } from "./components/Toasts"
import { useStudio, type ViewName } from "./store/useStore"
import { LspView } from "./views/LspView"
import { McpView } from "./views/McpView"
import { ModelsView } from "./views/ModelsView"
import { PluginsView } from "./views/PluginsView"
import { ProjectsView } from "./views/ProjectsView"
import { SettingsView } from "./views/SettingsView"
import { Spinner, StatusDot } from "./components/ui"
import { resolveLocale, setLocale } from "./i18n"
import { useT } from "./i18n/useT"

const VIEWS: Record<ViewName, () => React.ReactNode> = {
  chat: () => <ChatView />,
  projects: () => <ProjectsView />,
  models: () => <ModelsView />,
  mcp: () => <McpView />,
  lsp: () => <LspView />,
  plugins: () => <PluginsView />,
  settings: () => <SettingsView />,
}

function BootScreen() {
  const ready = useStudio((store) => store.ready)
  const state = useStudio((store) => store.state)
  const { t } = useT()
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-canvas">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-[20px] font-black text-accent-contrast">
        M
      </div>
      <div className="mt-4 text-[15px] font-semibold tracking-tight">OpenCode MeowStudio</div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
        {!ready || !state ? (
          <>
            <Spinner size={12} /> {t("common.loading")}
          </>
        ) : state.runtime.state === "downloading" ? (
          <>
            <Spinner size={12} /> {t("sidebar.downloading")} {state.runtime.version}
          </>
        ) : (
          <>
            <StatusDot tone="warn" /> {t("sidebar.backendStarting")}
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const state = useStudio((store) => store.state)
  const view = useStudio((store) => store.view)
  const ready = useStudio((store) => store.ready)
  const language = useStudio((store) => store.state?.settings.language ?? "system")
  const systemLocale = useStudio((store) => store.state?.locale ?? "en")

  useEffect(() => {
    setLocale(resolveLocale(language, systemLocale))
  }, [language, systemLocale])

  useEffect(() => {
    const off = window.studio.onEvent((event) => useStudio.getState().handleEvent(event))
    void useStudio.getState().init()
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const theme = useStudio.getState().state?.settings.theme
      if (!theme) return
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.dataset.theme = dark ? "dark" : "light"
    }
    media.addEventListener("change", onChange)
    return () => {
      off()
      media.removeEventListener("change", onChange)
    }
  }, [])

  if (!ready || !state) return <BootScreen />

  const View = VIEWS[view]
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas text-ink">
      <Sidebar />
      <main className="app-surface relative min-w-0 flex-1 overflow-hidden">{View()}</main>
      <PermissionDialog />
      <Toasts />
    </div>
  )
}

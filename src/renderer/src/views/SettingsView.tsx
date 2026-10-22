import clsx from "clsx"
import {
  Download,
  ExternalLink,
  FileJson,
  HardDrive,
  Info,
  Languages,
  Moon,
  Palette,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sun,
  Trash2,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { AppLanguage, ConfigScope, RawConfig, Settings, Theme } from "@shared/types"
import { Badge, Button, Field, Modal, PageHeader, ProgressBar, Spinner, StatusDot, Toggle } from "../components/ui"
import { formatBytes, formatError, rpc } from "../lib/rpc"
import { useStudio } from "../store/useStore"
import { useT } from "../i18n/useT"

const THEMES: Array<{ value: Theme; labelKey: string }> = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "system", labelKey: "settings.themeSystem" },
]

const LANGUAGES: Array<{ value: AppLanguage; labelKey: string }> = [
  { value: "system", labelKey: "settings.languageSystem" },
  { value: "en", labelKey: "settings.languageEnglish" },
  { value: "zh-CN", labelKey: "settings.languageChinese" },
]

function ThemeTile({ theme, active, onSelect }: { theme: Theme; active: boolean; onSelect: () => void }) {
  const { t } = useT()
  return (
    <button
      data-theme-option={theme}
      onClick={onSelect}
      className={clsx(
        "group rounded-xl border p-2.5 text-left transition-all",
        active ? "border-accent/60 bg-accent-soft/25" : "border-line bg-canvas hover:border-faint/70",
      )}
    >
      <div className="mb-2 overflow-hidden rounded-lg border border-line">
        {theme === "dark" && (
          <div className="flex h-12 bg-[#0b0d12]">
            <div className="w-1/3 border-r border-white/10 bg-[#12151d]" />
            <div className="flex-1 p-1.5">
              <div className="mb-1 h-1.5 w-2/3 rounded bg-white/20" />
              <div className="mb-1 h-1.5 w-full rounded bg-white/10" />
              <div className="h-1.5 w-4/5 rounded bg-white/10" />
            </div>
          </div>
        )}
        {theme === "light" && (
          <div className="flex h-12 bg-[#f7f6f2]">
            <div className="w-1/3 border-r border-black/10 bg-[#eeece5]" />
            <div className="flex-1 p-1.5">
              <div className="mb-1 h-1.5 w-2/3 rounded bg-black/25" />
              <div className="mb-1 h-1.5 w-full rounded bg-black/10" />
              <div className="h-1.5 w-4/5 rounded bg-black/10" />
            </div>
          </div>
        )}
        {theme === "system" && (
          <div className="flex h-12">
            <div className="flex w-1/2 bg-[#0b0d12] p-1.5">
              <div className="mt-auto h-1.5 w-2/3 rounded bg-white/20" />
            </div>
            <div className="flex w-1/2 bg-[#f7f6f2] p-1.5">
              <div className="mt-auto h-1.5 w-2/3 rounded bg-black/20" />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium">
        {theme === "dark" ? <Moon size={11} /> : theme === "light" ? <Sun size={11} /> : <Palette size={11} />}
        {t(THEMES.find((item) => item.value === theme)?.labelKey ?? "settings.theme")}
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
      </div>
    </button>
  )
}

export function SettingsView() {
  const { t } = useT()
  const state = useStudio((store) => store.state)
  const logs = useStudio((store) => store.logs)
  const updateSettings = useStudio((store) => store.updateSettings)
  const restartBackend = useStudio((store) => store.restartBackend)
  const ensureRuntime = useStudio((store) => store.ensureRuntime)
  const refreshLogs = useStudio((store) => store.refreshLogs)
  const addToast = useStudio((store) => store.addToast)

  const [version, setVersion] = useState(state?.settings.runtimeVersion ?? "")
  const [versions, setVersions] = useState<{ installed: string[]; latest?: string }>({ installed: [] })
  const [busy, setBusy] = useState(false)
  const [configScope, setConfigScope] = useState<ConfigScope>("project")
  const [editorOpen, setEditorOpen] = useState(false)
  const [raw, setRaw] = useState<RawConfig | null>(null)
  const [draft, setDraft] = useState("")
  const logsRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setVersion(state?.settings.runtimeVersion ?? "")
  }, [state?.settings.runtimeVersion])

  useEffect(() => {
    void refreshLogs()
    void rpc("runtime.versions").then(setVersions).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const node = logsRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logs])

  if (!state) return null
  const runtime = state.runtime
  const backend = state.backend
  const downloading = runtime.state === "downloading" || runtime.state === "extracting"

  const applyRuntime = async () => {
    if (!version.trim()) return
    setBusy(true)
    try {
      await updateSettings({ runtimeVersion: version.trim() })
      await ensureRuntime(true)
      setVersions(await rpc("runtime.versions"))
    } finally {
      setBusy(false)
    }
  }

  const openEditor = async (scope: ConfigScope) => {
    try {
      const result = await rpc("config.read", scope)
      setRaw(result)
      setDraft(result.content || '{\n  "$schema": "https://opencode.ai/config.json"\n}\n')
      setConfigScope(scope)
      setEditorOpen(true)
    } catch (error) {
      addToast("error", formatError(error))
    }
  }

  const saveConfig = async () => {
    try {
      const result = await rpc("config.write", configScope, draft)
      setRaw(result)
      addToast("success", t("toast.saved"))
      setEditorOpen(false)
    } catch (error) {
      addToast("error", formatError(error))
    }
  }

  const patchSettings = (patch: Partial<Settings>) => {
    void updateSettings(patch)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        description={t("settings.description")}
        actions={
          <Button onClick={() => void restartBackend()}>
            <RefreshCw size={12} /> {t("common.restart")}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <section className="rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex items-center gap-2">
            <Palette size={15} className="text-accent" />
            <div>
              <div className="card-heading">{t("settings.appearance")}</div>
              <div className="text-[11.5px] text-muted">{t("settings.appearanceDesc")}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-[1fr_240px]">
            <div>
              <div className="label">{t("settings.theme")}</div>
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((theme) => (
                  <ThemeTile
                    key={theme.value}
                    theme={theme.value}
                    active={state.settings.theme === theme.value}
                    onSelect={() => patchSettings({ theme: theme.value })}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5">
                <Languages size={11} /> {t("settings.language")}
              </div>
              <div className="space-y-1.5">
                {LANGUAGES.map((language) => {
                  const active = state.settings.language === language.value
                  return (
                    <button
                      key={language.value}
                      data-language-option={language.value}
                      onClick={() => patchSettings({ language: language.value })}
                      className={clsx(
                        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors",
                        active
                          ? "border-accent/50 bg-accent-soft/25 text-ink"
                          : "border-line bg-canvas text-muted hover:border-faint/70 hover:text-ink",
                      )}
                    >
                      <span className="min-w-0 flex-1">{t(language.labelKey)}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </button>
                  )
                })}
              </div>
              <div className="mt-1.5 text-[10px] leading-relaxed text-faint">{t("settings.languageDesc")}</div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section className="rounded-xl border border-line bg-surface/60 p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-accent" />
              <div>
                <div className="card-heading">{t("settings.profile")}</div>
                <div className="text-[11.5px] text-muted">{t("settings.profileDesc")}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["global", "isolated"] as const).map((profile) => (
                <button
                  key={profile}
                  className={clsx(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    state.settings.profile === profile
                      ? "border-accent/50 bg-accent-soft/30"
                      : "border-line bg-canvas hover:border-faint",
                  )}
                  onClick={() => patchSettings({ profile })}
                >
                  <div className="text-[12.5px] font-medium">
                    {profile === "global" ? t("settings.profileGlobal") : t("settings.profileIsolated")}
                  </div>
                  <div className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                    {profile === "global" ? t("settings.profileGlobalDesc") : t("settings.profileIsolatedDesc")}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[10.5px] leading-relaxed text-faint">
              <div className="truncate">{t("settings.configShort")}: {state.configPaths.globalFile}</div>
              <div className="truncate">{t("settings.pluginsShort")}: {state.configPaths.globalPlugins}</div>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-surface/60 p-4">
            <div className="flex items-center gap-2">
              <HardDrive size={15} className="text-accent" />
              <div>
                <div className="card-heading">{t("settings.runtime")}</div>
                <div className="text-[11.5px] text-muted">{t("settings.runtimeDesc")}</div>
              </div>
              <Badge
                className="ml-auto"
                tone={runtime.state === "ready" ? "good" : runtime.state === "error" ? "bad" : "warn"}
              >
                {t(`status.${runtime.state}`)}
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field
                label={t("settings.version")}
                hint={versions.latest ? t("settings.latest", { version: versions.latest }) : undefined}
              >
                <input className="input font-mono" value={version} onChange={(event) => setVersion(event.target.value)} />
              </Field>
              <Field label={t("settings.installed")}>
                <select
                  className="input font-mono"
                  value={versions.installed.includes(version) ? version : ""}
                  onChange={(event) => event.target.value && setVersion(event.target.value)}
                >
                  <option value="">{t("settings.selectInstalled")}</option>
                  {versions.installed.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Toggle
                checked={state.settings.autoDownload}
                onChange={(next) => patchSettings({ autoDownload: next })}
                label={t("settings.autoDownload")}
              />
              <span className="text-[12px] text-muted">{t("settings.autoDownloadDesc")}</span>
              <Button className="ml-auto" variant="primary" onClick={() => void applyRuntime()} disabled={busy || downloading}>
                {busy || downloading ? <Spinner size={12} /> : <Download size={12} />} {t("settings.applyDownload")}
              </Button>
            </div>
            {downloading && (
              <div className="mt-3">
                <ProgressBar value={runtime.received ?? 0} max={runtime.total} />
                <div className="mt-1 flex justify-between text-[10px] text-faint">
                  <span>{runtime.state === "extracting" ? t("settings.extracting") : t("settings.downloading")}</span>
                  <span>
                    {formatBytes(runtime.received)} / {formatBytes(runtime.total)}
                  </span>
                </div>
              </div>
            )}
            <div className="mt-3 space-y-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[10.5px] text-faint">
              <div className="truncate">
                {t("settings.binary")}: {runtime.binaryPath ?? t("settings.unavailable")}
              </div>
              <div>
                {t("settings.source")}:{" "}
                {runtime.source === "cache"
                  ? t("settings.sourceCache")
                  : runtime.source === "downloaded"
                    ? t("settings.sourceDownloaded")
                    : runtime.source === "system"
                      ? t("settings.sourceSystem")
                      : runtime.source === "override"
                        ? t("settings.sourceOverride")
                        : "-"}{" "}
                | {t("settings.reportedVersion")}: {runtime.version ?? "-"}
              </div>
              {runtime.error && <div className="text-bad">{runtime.error}</div>}
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileJson size={15} className="text-accent" />
            <div>
              <div className="card-heading">{t("settings.configFiles")}</div>
              <div className="text-[11.5px] text-muted">{t("settings.configFilesDesc")}</div>
            </div>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button onClick={() => void openEditor("project")} disabled={!state.activeProject}>
                {t("settings.editProjectConfig")}
              </Button>
              <Button onClick={() => void openEditor("global")}>{t("settings.editGlobalConfig")}</Button>
              <Button
                onClick={() =>
                  void rpc("app.openPath", state.configPaths.projectFile ?? "").catch((error) =>
                    addToast("error", formatError(error)),
                  )
                }
                disabled={!state.configPaths.projectFile}
              >
                <ExternalLink size={12} /> {t("settings.projectFile")}
              </Button>
              <Button
                onClick={() =>
                  void rpc("app.openPath", state.configPaths.globalFile).catch((error) =>
                    addToast("error", formatError(error)),
                  )
                }
              >
                <ExternalLink size={12} /> {t("settings.globalFile")}
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-canvas px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{t("settings.projectFile")}</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                {state.configPaths.projectFile ?? t("settings.noProject")}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{t("settings.globalFile")}</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted">{state.configPaths.globalFile}</div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Info size={15} className="text-accent" />
            <div>
              <div className="card-heading">{t("settings.backendLogs")}</div>
              <div className="text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={backend.state === "running" ? "good" : backend.state === "error" ? "bad" : "warn"} />
                  {t(`status.${backend.state}`)}
                </span>
                {backend.url && <span className="ml-2 font-mono">{backend.url}</span>}
                {backend.pid && <span className="ml-2">{t("settings.pid", { pid: backend.pid })}</span>}
              </div>
            </div>
            <div className="ml-auto flex gap-1.5">
              <Button onClick={() => void refreshLogs()}>
                <RefreshCw size={12} /> {t("settings.refresh")}
              </Button>
              <Button
                onClick={async () => {
                  await rpc("app.clearLogs")
                  await refreshLogs()
                }}
              >
                <Trash2 size={12} /> {t("settings.clear")}
              </Button>
            </div>
          </div>
          <pre
            ref={logsRef}
            className="mt-3 h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-3 font-mono text-[10.5px] leading-relaxed text-muted"
          >
            {logs.length === 0 ? t("settings.noLogs") : logs.join("\n")}
          </pre>
        </section>

        <section className="mt-5 rounded-xl border border-line bg-surface/40 p-4">
          <div className="text-[12.5px] font-semibold">{t("settings.about")}</div>
          <div className="mt-2 grid gap-2 text-[11.5px] text-muted md:grid-cols-2">
            <div>
              OpenCode MeowStudio <span className="text-ink">{state.appVersion}</span> | Electron{" "}
              <span className="font-mono">{window.studio.versions.electron}</span> | Chrome{" "}
              <span className="font-mono">{window.studio.versions.chrome}</span>
            </div>
            <div>
              opencode SDK <span className="font-mono">@opencode-ai/sdk 1.19.3</span> | backend{" "}
              <span className="font-mono">{backend.version ?? runtime.version ?? "-"}</span>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{t("settings.dataDir")}</div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted" title={state.userDataDir}>
              {state.userDataDir}
            </div>
            <div className="mt-1.5">
              <Button
                className="h-6 px-2 text-[10.5px]"
                onClick={() => void rpc("app.openPath", state.userDataDir).catch((error) => addToast("error", formatError(error)))}
              >
                <ExternalLink size={10} /> {t("settings.openDataDir")}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void rpc("app.openExternal", "https://opencode.ai/docs")}>
              <ExternalLink size={12} /> {t("settings.docs")}
            </Button>
            <Button onClick={() => void rpc("app.openExternal", "https://opencode.ai/config.json")}>
              <ExternalLink size={12} /> {t("settings.schema")}
            </Button>
          </div>
        </section>
      </div>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <FileJson size={15} className="text-accent" />
            {configScope === "project" ? t("settings.editProjectConfig") : t("settings.editGlobalConfig")}
            <span className="font-mono text-[10.5px] font-normal text-faint">{raw?.path}</span>
          </span>
        }
        width="max-w-4xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setConfigScope((current) => (current === "project" ? "global" : "project"))
                void openEditor(configScope === "project" ? "global" : "project")
              }}
            >
              {t("settings.switchTo", {
                scope: configScope === "project" ? t("common.global") : t("common.project"),
              })}
            </Button>
            <Button variant="primary" onClick={() => void saveConfig()}>
              <Save size={12} /> {t("settings.saveReload")}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-faint">
            <span>{t("settings.jsoncHint")}</span>
            <span>{t("settings.lines", { count: draft.split(/\r?\n/).length })}</span>
          </div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="h-[58vh] w-full resize-none rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent/60"
          />
        </div>
      </Modal>
    </div>
  )
}



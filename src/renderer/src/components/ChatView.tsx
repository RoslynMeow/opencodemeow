import clsx from "clsx"
import {
  ArrowUp,
  Check,
  ChevronRight,
  CornerUpLeft,
  Cpu,
  GitBranch,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  Square,
  Terminal,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FileDiff } from "@shared/types"
import { useStudio } from "../store/useStore"
import { AgentPicker, ModelPicker } from "./ModelPicker"
import { MessageItem, OptimisticUserMessage } from "./Message"
import { Button, EmptyState, IconButton, Modal, Spinner, StatusDot } from "./ui"
import { useT } from "../i18n/useT"
import { buildSessionTree, countDescendants, sessionRootId } from "../lib/session-tree"
import { TaskTree } from "./TaskTree"

function DiffModal() {
  const open = useStudio((state) => state.diffOpen)
  const loading = useStudio((state) => state.diffLoading)
  const diff = useStudio((state) => state.diff)
  const close = useStudio((state) => state.closeDiff)
  const { t } = useT()
  const totalAdd = diff.reduce((sum, file) => sum + file.additions, 0)
  const totalDel = diff.reduce((sum, file) => sum + file.deletions, 0)

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <GitBranch size={15} className="text-accent" />
          {t("chat.changesTitle")}
          <span className="text-[11px] font-normal text-faint">
            {t("chat.changesSummary", { files: diff.length, additions: totalAdd, deletions: totalDel })}
          </span>
        </span>
      }
      width="max-w-4xl"
    >
      {loading ? (
        <div className="flex items-center justify-center py-14 text-muted">
          <Spinner />
        </div>
      ) : diff.length === 0 ? (
        <EmptyState title={t("chat.noChanges")} description={t("chat.noChangesHint")} />
      ) : (
        <div className="space-y-3">
          {diff.map((file) => (
            <DiffFile key={file.file} file={file} />
          ))}
        </div>
      )}
    </Modal>
  )
}

function DiffFile({ file }: { file: FileDiff }) {
  const { t } = useT()
  return (
    <details className="overflow-hidden rounded-lg border border-line bg-canvas/60">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 font-mono text-[11.5px] hover:bg-line-soft/40">
        <ChevronRight size={12} className="text-faint" />
        <span className="min-w-0 flex-1 truncate">{file.file}</span>
        <span className="text-good">+{file.additions}</span>
        <span className="text-bad">-{file.deletions}</span>
      </summary>
      <div className="grid gap-2 border-t border-line p-2 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{t("chat.before")}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-canvas p-2 font-mono text-[10.5px] leading-relaxed text-muted">
            {file.before || t("chat.emptyFile")}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{t("chat.after")}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-canvas p-2 font-mono text-[10.5px] leading-relaxed text-muted">
            {file.after || t("chat.emptyFile")}
          </pre>
        </div>
      </div>
    </details>
  )
}

export function ChatView() {
  const state = useStudio((store) => store.state)
  const sessions = useStudio((store) => store.sessions)
  const activeSessionId = useStudio((store) => store.activeSessionId)
  const messages = useStudio((store) => store.messages)
  const loadingMessages = useStudio((store) => store.loadingMessages)
  const busy = useStudio((store) => store.busy)
  const retryMessage = useStudio((store) => store.retryMessage)
  const optimisticUser = useStudio((store) => store.optimisticUser)
  const providers = useStudio((store) => store.providers)
  const commands = useStudio((store) => store.commands)
  const selectedModels = useStudio((store) => store.selectedModels)
  const setView = useStudio((store) => store.setView)
  const send = useStudio((store) => store.send)
  const abort = useStudio((store) => store.abort)
  const showDiff = useStudio((store) => store.showDiff)
  const renameSession = useStudio((store) => store.renameSession)
  const newSession = useStudio((store) => store.newSession)
  const openSession = useStudio((store) => store.openSession)
  const pickAndAddProject = useStudio((store) => store.pickAndAddProject)
  const { t } = useT()

  const [text, setText] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [stickToBottom, setStickToBottom] = useState(true)
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem("meowstudio:treeOpen") === "1")
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const session = sessions.find((item) => item.id === activeSessionId)
  const projectId = state?.activeProjectId ?? null
  const hasModel = Boolean(projectId && (selectedModels[projectId] || providers?.defaultModel))
  const running = state?.backend.state === "running"
  const treeRootId = useMemo(() => sessionRootId(sessions, activeSessionId), [sessions, activeSessionId])
  const tree = useMemo(() => buildSessionTree(sessions, treeRootId), [sessions, treeRootId])
  const childCount = countDescendants(tree)
  const toggleTree = () => {
    setTreeOpen((current) => {
      const next = !current
      localStorage.setItem("meowstudio:treeOpen", next ? "1" : "0")
      return next
    })
  }

  const suggestions = [
    { title: t("chat.suggestion.explain.title"), prompt: t("chat.suggestion.explain.prompt") },
    { title: t("chat.suggestion.fix.title"), prompt: t("chat.suggestion.fix.prompt") },
    { title: t("chat.suggestion.tests.title"), prompt: t("chat.suggestion.tests.prompt") },
    { title: t("chat.suggestion.feature.title"), prompt: t("chat.suggestion.feature.prompt") },
  ]

  useEffect(() => {
    if (!stickToBottom) return
    endRef.current?.scrollIntoView({ behavior: messages.length > 0 ? "smooth" : "auto", block: "end" })
  }, [messages, optimisticUser, busy, stickToBottom])

  useEffect(() => {
    setStickToBottom(true)
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [activeSessionId])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(200, node.scrollHeight)}px`
  }, [text])

  const slashMatches = useMemo(() => {
    if (!text.startsWith("/") || text.includes(" ")) return []
    const needle = text.slice(1).toLowerCase()
    return commands.filter((command) => command.name.toLowerCase().includes(needle)).slice(0, 8)
  }, [text, commands])

  if (!state) return null
  if (!state.activeProject) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/15 to-transparent text-accent">
            <Terminal size={23} />
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight">{t("chat.openProjectTitle")}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("chat.openProjectDesc")}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => void pickAndAddProject()}>
              <Plus size={14} /> {t("chat.openFolder")}
            </Button>
            <Button onClick={() => setView("projects")}>{t("chat.manageProjects")}</Button>
          </div>
        </div>
      </div>
    )
  }

  const submit = () => {
    const value = text.trim()
    if (!value) return
    setText("")
    setStickToBottom(true)
    void send(value)
  }

  const startEditingTitle = () => {
    if (!session) return
    setTitleDraft(session.title)
    setEditingTitle(true)
  }

  const saveTitle = () => {
    if (session && titleDraft.trim()) void renameSession(session.id, titleDraft.trim())
    setEditingTitle(false)
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[54px] shrink-0 items-center gap-2 border-b border-line/80 px-5">
        {session ? (
          <div className="flex min-w-0 items-center gap-2">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveTitle()
                  if (event.key === "Escape") setEditingTitle(false)
                }}
                className="h-7 w-64 rounded-md border border-accent/50 bg-canvas px-2 text-[13px] outline-none"
              />
            ) : (
              <button
                className="group flex min-w-0 items-center gap-1.5 text-[13px] font-medium"
                onClick={startEditingTitle}
                title={t("chat.renameSession")}
              >
                <span className="max-w-[340px] truncate">{session.title || t("chat.newConversation")}</span>
                <Pencil size={11} className="text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
            <div className="hidden min-w-0 items-center gap-1.5 text-[10.5px] text-faint lg:flex">
              <span>·</span>
              <span className="max-w-[320px] truncate" title={state.activeProject.path}>
                {state.activeProject.path}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <MessageSquare size={14} className="text-faint" /> {t("chat.newConversation")}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {session?.parentID && (
            <Button
              variant="ghost"
              className="h-8 px-2 text-[11.5px]"
              onClick={() => void openSession(session.parentID as string)}
              title={t("tree.backToParent")}
            >
              <CornerUpLeft size={13} />
              <span className="hidden xl:inline">{t("tree.backToParent")}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            data-action="task-tree"
            className={clsx("h-8 px-2 text-[11.5px]", treeOpen && "bg-raised text-accent")}
            onClick={toggleTree}
            title={t("tree.title")}
          >
            <Network size={13} />
            <span className="hidden md:inline">{t("tree.title")}</span>
            {childCount > 0 && (
              <span className="rounded-full bg-accent-soft/60 px-1.5 text-[9px] font-semibold text-accent">{childCount}</span>
            )}
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2 text-[11.5px]"
            onClick={() => void showDiff()}
            disabled={!session}
            title={t("chat.sessionChanges")}
          >
            <GitBranch size={13} /> {t("chat.sessionChanges")}
          </Button>
          <IconButton onClick={() => void newSession()} title={t("chat.newChat")} disabled={!running}>
            <Plus size={15} />
          </IconButton>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto pb-8"
          onScroll={(event) => {
            const node = event.currentTarget
            setStickToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 90)
          }}
        >
          {!running && (
            <div className="mx-auto mt-4 flex max-w-3xl items-center gap-2 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-[12px] text-bad">
              <StatusDot tone="bad" />
              {t("chat.backendDown")}
            </div>
          )}
          {!hasModel && running && (
            <div className="mx-auto mt-4 flex max-w-3xl items-center gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              <Cpu size={13} />
              {t("chat.noModel")}
              <button className="ml-auto underline" onClick={() => setView("models")}>
                {t("chat.openModels")}
              </button>
            </div>
          )}
          {retryMessage && (
            <div className="mx-auto mt-3 flex max-w-3xl items-center gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              <Spinner size={12} />
              {t("chat.retryProvider", { message: retryMessage })}
            </div>
          )}

          {messages.length === 0 && !loadingMessages ? (
            <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center px-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 to-accent/5 text-accent shadow-sm">
                <MessageSquare size={20} />
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight">{t("chat.heroTitle")}</h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("chat.heroWorkingIn", { project: state.activeProject.name })}
              </p>
              <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.title}
                    className="rounded-xl border border-line bg-surface/70 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-raised hover:shadow-lg"
                    onClick={() => void send(suggestion.prompt)}
                  >
                    <div className="text-[12.5px] font-medium">{suggestion.title}</div>
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{suggestion.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : loadingMessages ? (
            <div className="flex h-full items-center justify-center text-muted">
              <Spinner />
            </div>
          ) : (
            <div className="mx-auto max-w-[1000px] py-4">
              {messages.map((entry, index) => (
                <MessageItem key={entry.info.id} entry={entry} busy={busy} isLast={index === messages.length - 1} />
              ))}
              {optimisticUser && <OptimisticUserMessage text={optimisticUser} />}
              <div ref={endRef} className="h-1" />
            </div>
          )}
        </div>
      </div>

      <div className="relative shrink-0 px-5 pb-4">
        {slashMatches.length > 0 && (
          <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            {slashMatches.map((command) => (
              <button
                key={command.name}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-line-soft"
                onClick={() => {
                  setText(`/${command.name} `)
                  textareaRef.current?.focus()
                }}
              >
                <Terminal size={12} className="text-accent" />
                <span className="font-mono">/{command.name}</span>
                <span className="min-w-0 flex-1 truncate text-faint">{command.description ?? ""}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-line bg-surface p-2 shadow-xl shadow-black/10 transition-colors focus-within:border-accent/40">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
              rows={1}
              disabled={!running}
              placeholder={
                running
                  ? t("chat.placeholder")
                  : state.backend.state === "starting"
                    ? t("chat.placeholderStarting")
                    : t("chat.placeholderUnavailable")
              }
              className="max-h-[200px] w-full resize-none bg-transparent px-2.5 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-faint disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
              <ModelPicker compact direction="up" onManage={() => setView("models")} />
              <AgentPicker compact />
              <span className="ml-auto hidden text-[10px] text-faint sm:inline">{t("chat.composerHint")}</span>
              <div className="flex items-center gap-1">
                {busy ? (
                  <Button variant="ghost" className="h-8 px-2 text-[11.5px]" onClick={() => void abort()}>
                    <Square size={11} className="fill-current" /> {t("chat.stop")}
                  </Button>
                ) : (
                  <button
                    className={clsx(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      text.trim() && running
                        ? "bg-accent text-accent-contrast hover:bg-accent-strong"
                        : "bg-line-soft text-faint",
                    )}
                    onClick={submit}
                    disabled={!text.trim() || !running}
                    title={t("chat.send")}
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2 px-1 text-[10px] text-faint">
            <Check size={10} />
            {t("chat.footerHint")}
            {session && <span className="ml-auto shrink-0">{t("chat.messagesCount", { count: messages.length })}</span>}
          </div>
        </div>
      </div>

      </div>

      {treeOpen && <TaskTree onClose={() => setTreeOpen(false)} />}
      <DiffModal />
    </div>
  )
}

import clsx from "clsx"
import { AlertTriangle, Bot, Check, ChevronRight, Coins, Copy, RefreshCw, Users, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { Session, SessionUsage } from "@shared/types"
import { useStudio } from "../store/useStore"
import { useT } from "../i18n/useT"
import { formatDate } from "../lib/config-utils"
import { rpc } from "../lib/rpc"
import { buildSessionTree, collectSessionIds, countDescendants, sessionRootId, type SessionTreeNode } from "../lib/session-tree"
import { Badge, Button, IconButton, Modal, Spinner, StatusDot } from "./ui"

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

function duration(session: Session, running: boolean): string {
  const end = running ? Date.now() : session.time.updated
  const seconds = Math.max(0, Math.round((end - session.time.created) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function TaskTree({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const sessions = useStudio((store) => store.sessions)
  const activeSessionId = useStudio((store) => store.activeSessionId)
  const sessionStatuses = useStudio((store) => store.sessionStatuses)
  const sessionErrors = useStudio((store) => store.sessionErrors)
  const usage = useStudio((store) => store.usage)
  const treeVersion = useStudio((store) => store.treeVersion)
  const refreshUsage = useStudio((store) => store.refreshUsage)
  const openSession = useStudio((store) => store.openSession)
  const addToast = useStudio((store) => store.addToast)
  const [selected, setSelected] = useState<Session | null>(null)

  const installCoordinator = async () => {
    if (!window.confirm(t("tree.installCoordinatorConfirm"))) return
    try {
      await rpc("config.patch", "project", ["agent", "coordinator"], {
        description: "Breaks work into independent subtasks and delegates them to subagents in parallel.",
        mode: "primary",
        prompt: t("tree.coordinatorPrompt"),
      })
      await useStudio.getState().refreshAll()
      useStudio.getState().setAgent("coordinator")
      addToast("success", t("tree.coordinatorInstalled"))
    } catch (error) {
      addToast("error", (error as Error).message)
    }
  }

  const rootId = useMemo(() => sessionRootId(sessions, activeSessionId), [sessions, activeSessionId])
  const tree = useMemo(() => buildSessionTree(sessions, rootId), [sessions, rootId, treeVersion])
  const ids = useMemo(() => collectSessionIds(tree), [tree])
  const children = countDescendants(tree)

  useEffect(() => {
    if (ids.length === 0) return
    void refreshUsage(ids)
    const timer = setInterval(() => void refreshUsage(ids), 4000)
    return () => clearInterval(timer)
  }, [ids.join("|"), refreshUsage])

  const totalCost = ids.reduce((sum, id) => sum + (usage[id]?.cost ?? 0), 0)
  const totalTokens = ids.reduce((sum, id) => {
    const item = usage[id]
    return sum + (item ? item.tokens.input + item.tokens.output : 0)
  }, 0)
  const running = ids.filter((id) => {
    const status = sessionStatuses[id]?.type
    return status === "busy" || status === "retry"
  }).length

  const statusOf = (session: Session): { tone: "good" | "warn" | "bad" | "default" | "accent"; label: string } => {
    if (sessionErrors[session.id]) return { tone: "bad", label: t("status.error") }
    const status = sessionStatuses[session.id]
    if (status?.type === "retry") return { tone: "warn", label: t("status.retry") }
    if (status?.type === "busy") return { tone: "accent", label: t("status.busy") }
    if (usage[session.id]?.completed) return { tone: "good", label: t("status.completed") }
    return { tone: "default", label: t("status.idle") }
  }

  const renderNode = (node: SessionTreeNode, depth: number) => {
    const isRoot = depth === 0
    const isActive = node.session.id === activeSessionId
    const status = statusOf(node.session)
    const item = usage[node.session.id]
    const error = sessionErrors[node.session.id]
    return (
      <div key={node.session.id}>
        <button
          data-session-node={node.session.id}
          onClick={() => setSelected(node.session)}
          className={clsx(
            "group relative w-full rounded-lg border px-2 py-1.5 text-left transition-colors",
            isActive
              ? "border-accent/40 bg-accent-soft/25"
              : "border-transparent hover:border-line hover:bg-line-soft/50",
          )}
        >
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">
              {status.tone === "accent" || status.tone === "warn" ? (
                <Spinner size={10} className={status.tone === "warn" ? "text-warn" : "text-accent"} />
              ) : (
                <StatusDot tone={status.tone} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={clsx("truncate text-[12px]", isRoot ? "font-semibold" : "font-medium")}>
                  {node.session.title || t("chat.newConversation")}
                </span>
                {isRoot && <Badge className="shrink-0 text-[8.5px]">{t("tree.coordinator")}</Badge>}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-faint">
                <span className="inline-flex items-center gap-1">
                  <Bot size={9} />
                  {item?.agent ?? (isRoot ? "build" : t("tree.subagent"))}
                </span>
                <span>{formatCost(item?.cost ?? 0)}</span>
                <span>{compactTokens(item ? item.tokens.input + item.tokens.output : 0)} tok</span>
                <span>{duration(node.session, status.tone === "accent" || status.tone === "warn")}</span>
              </span>
              {error && <span className="mt-1 block truncate text-[9.5px] text-bad">{error}</span>}
            </span>
            <ChevronRight size={11} className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </button>
        {node.children.length > 0 && (
          <div className="ml-2.5 border-l border-line/60 pl-1.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const selectedUsage: SessionUsage | undefined = selected ? usage[selected.id] : undefined
  const selectedStatus = selected ? statusOf(selected) : null

  return (
    <>
      <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-line bg-surface/80">
        <div className="border-b border-line px-3 pb-2.5 pt-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/25 bg-accent-soft/40 text-accent">
              <Bot size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold">{t("tree.title")}</div>
              <div className="truncate text-[9.5px] text-faint">{t("tree.subtitle")}</div>
            </div>
            <IconButton className="h-6 w-6" onClick={() => void refreshUsage(ids)} title={t("tree.refresh")}>
              <RefreshCw size={11} />
            </IconButton>
            <IconButton className="h-6 w-6" onClick={onClose} title={t("tree.close")}>
              <X size={12} />
            </IconButton>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-line bg-canvas px-2 py-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-faint">{t("tree.totalCost")}</div>
              <div className="mt-0.5 font-mono text-[11.5px] font-medium text-ink">{formatCost(totalCost)}</div>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-2 py-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-faint">{t("tree.totalTokens")}</div>
              <div className="mt-0.5 font-mono text-[11.5px] font-medium text-ink">{compactTokens(totalTokens)}</div>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-2 py-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-faint">{t("tree.children", { count: children })}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-ink">
                {running > 0 && <Spinner size={9} className="text-accent" />}
                {t("tree.active", { count: running })}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {tree ? (
            <>
              {renderNode(tree, 0)}
              {children === 0 && (
                <div className="mx-1 mt-2 rounded-lg border border-dashed border-line px-3 py-4">
                  <div className="text-[11.5px] font-medium text-muted">{t("tree.emptyTitle")}</div>
                  <div className="mt-1 text-[10.5px] leading-relaxed text-faint">{t("tree.emptyDesc")}</div>
                  <div className="mt-2 rounded-md border border-line bg-canvas px-2 py-1.5 text-[10px] leading-relaxed text-muted">
                    {t("tree.coordinatorPrompt")}
                  </div>
                  <button
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-accent hover:underline"
                    onClick={() => {
                      void navigator.clipboard.writeText(t("tree.coordinatorPrompt")).then(
                        () => addToast("success", t("common.copied")),
                        () => addToast("error", t("common.error")),
                      )
                    }}
                  >
                    <Copy size={10} /> {t("tree.copyPrompt")}
                  </button>
                  <Button className="mt-2 h-7 w-full px-2 text-[10.5px]" onClick={() => void installCoordinator()}>
                    <Users size={11} /> {t("tree.installCoordinator")}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="px-2 py-4 text-center text-[11px] text-faint">{t("chat.newConversation")}</div>
          )}
        </div>
      </aside>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? selected.title || t("chat.newConversation") : t("tree.details")}
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t("common.close")}
            </Button>
            {selected && selected.id === activeSessionId ? (
              <Button disabled>{t("tree.current")}</Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  if (selected) void openSession(selected.id)
                  setSelected(null)
                }}
              >
                {t("tree.openChat")}
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot tone={selectedStatus?.tone ?? "default"} />
              <Badge tone={selectedStatus?.tone === "bad" ? "bad" : selectedStatus?.tone === "good" ? "good" : "default"}>
                {selectedStatus?.label}
              </Badge>
              <span className="font-mono text-[10px] text-faint">{selected.id}</span>
            </div>
            {selected.parentID && (
              <div className="text-[11px] text-faint">
                {t("tree.parent")}:{" "}
                <span className="font-mono">
                  {sessions.find((session) => session.id === selected.parentID)?.title ?? selected.parentID}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-faint">{t("tree.agent")}</div>
                <div className="mt-0.5">{selectedUsage?.agent ?? t("tree.subagent")}</div>
              </div>
              <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-faint">{t("tree.model")}</div>
                <div className="mt-0.5 truncate">
                  {selectedUsage?.model ? `${selectedUsage.model.providerID}/${selectedUsage.model.modelID}` : "-"}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-faint">{t("tree.cost")}</div>
                <div className="mt-0.5 font-mono">{formatCost(selectedUsage?.cost ?? 0)}</div>
              </div>
              <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-faint">{t("tree.duration")}</div>
                <div className="mt-0.5">
                  {duration(selected, selectedStatus?.tone === "accent" || selectedStatus?.tone === "warn")}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-canvas p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
                <Coins size={10} /> {t("tree.tokens")}
              </div>
              <div className="grid grid-cols-2 gap-y-1 text-[11px] text-muted">
                <span>{t("tree.input")}</span>
                <span className="text-right font-mono">{selectedUsage?.tokens.input ?? 0}</span>
                <span>{t("tree.output")}</span>
                <span className="text-right font-mono">{selectedUsage?.tokens.output ?? 0}</span>
                <span>{t("tree.reasoning")}</span>
                <span className="text-right font-mono">{selectedUsage?.tokens.reasoning ?? 0}</span>
                <span>{t("tree.cacheRead")}</span>
                <span className="text-right font-mono">{selectedUsage?.tokens.cacheRead ?? 0}</span>
                <span>{t("tree.cacheWrite")}</span>
                <span className="text-right font-mono">{selectedUsage?.tokens.cacheWrite ?? 0}</span>
                <span>{t("tree.messages")}</span>
                <span className="text-right font-mono">{selectedUsage?.messages ?? 0}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10.5px] text-faint">
              <div>
                {t("tree.created")}: {formatDate(selected.time.created)}
              </div>
              <div>
                {t("tree.updated")}: {formatDate(selected.time.updated)}
              </div>
            </div>
            {!selectedUsage && <div className="text-[11px] text-faint">{t("tree.noUsage")}</div>}
            {sessionErrors[selected.id] && (
              <div className="flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/5 px-2.5 py-2 text-[11px] text-bad">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {sessionErrors[selected.id]}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-faint">
              <Check size={10} /> {t("tree.details")}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

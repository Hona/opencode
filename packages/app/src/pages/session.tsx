import type { Project, UserMessage } from "@opencode-ai/sdk/v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createQuery, skipToken, useMutation, useQueryClient } from "@tanstack/solid-query"
import {
  batch,
  onCleanup,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  on,
  onMount,
  untrack,
  createResource,
  createRoot,
  getOwner,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { debounce } from "@solid-primitives/scheduled"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Select } from "@opencode-ai/ui/select"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@/utils/toast"
import { base64Encode, checksum } from "@opencode-ai/core/util/encode"
import { useLocation, useSearchParams } from "@solidjs/router"
import { NewSessionDesignView, NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useServerContext, useServerSDK, useServerSync } from "@/context/server-context"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK, useSync } from "@/context/directory"
import { useSettings } from "@/context/settings"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import {
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  focusTerminalById,
  shouldFocusTerminalOnKeyDown,
} from "@/pages/session/helpers"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { shouldUseV2NewSessionPage } from "@/pages/session/new-session-layout"
import { Identifier } from "@/utils/id"
import { diffs as list } from "@/utils/diffs"
import { Persist, persisted } from "@/utils/persist"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"
import { useUsageExceededDialogs } from "./session/usage-exceeded-dialogs"
import { createScopedCache } from "@/utils/scoped-cache"
import { ScopedKey } from "@/utils/server-scope"

const emptyUserMessages: UserMessage[] = []
type FollowupItem = FollowupDraft & { id: string }
type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">
type FollowupState = {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  edit: Record<string, FollowupEdit | undefined>
}
const emptyFollowups: FollowupItem[] = []

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"
const MAX_PAGE_SESSION_STATES = 20

function createPageSessionState() {
  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
      top: 0,
    },
  })
  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "git" as ChangeMode,
    newSessionWorktree: "main",
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })
  return { ui, setUi, store, setStore }
}

type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

function createSessionHistoryLoader(input: SessionHistoryWindowInput) {
  const historyScrollThreshold = 200
  let shiftFrame: number | undefined

  const [state, setState] = createStore({
    shift: false,
  })

  const userMessages = createMemo(() => input.visibleUserMessages(), emptyUserMessages, {
    equals: same,
  })

  const cancelShiftReset = () => {
    if (shiftFrame === undefined) return
    cancelAnimationFrame(shiftFrame)
    shiftFrame = undefined
  }

  const scheduleShiftReset = () => {
    cancelShiftReset()
    shiftFrame = requestAnimationFrame(() => {
      shiftFrame = undefined
      setState("shift", false)
    })
  }

  const fetchOlderMessages = async () => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    // TODO(session-timeline): switch this to core cursor-based part pagination when that API lands.
    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()
    let growth = 0

    cancelShiftReset()
    setState("shift", true)

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      loaded = nextLoaded
      growth = input.visibleUserMessages().length - beforeVisible

      if (growth > 0) break
      if (raw <= 0) break
      if (!input.historyMore()) break
    }

    if (growth > 0) {
      scheduleShiftReset()
      return
    }

    setState("shift", false)
  }

  const loadAndReveal = () => fetchOlderMessages()

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const el = input.scroller()
    if (!el) return
    if (el.scrollTop >= historyScrollThreshold) return

    void fetchOlderMessages()
  }

  createEffect(
    on(
      input.sessionID,
      () => {
        cancelShiftReset()
        setState({ shift: false })
      },
      { defer: true },
    ),
  )

  onCleanup(cancelShiftReset)

  return {
    userMessages,
    shift: () => state.shift,
    loadAndReveal,
    onScrollerScroll,
  }
}

export default function Page() {
  const serverSync = useServerSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const server = useServerContext()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const location = useLocation()
  const { directory, sessionID: currentSessionID, sessionKey, tabs, view } = useSessionLayout()
  const routeDir = () => base64Encode(directory())
  const newSessionDesign = createMemo(() => settings.general.newLayoutDesigns())
  const sessionStateCache = createScopedCache(() => createPageSessionState(), { maxEntries: MAX_PAGE_SESSION_STATES })
  onCleanup(() => sessionStateCache.clear())
  const sessionState = createMemo(() => sessionStateCache.get(sessionKey()))

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (currentSessionID()) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  const composer = createSessionComposerState()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const isV2NewSessionPage = () =>
    shouldUseV2NewSessionPage({ newLayoutDesigns: newSessionDesign(), sessionID: currentSessionID() })
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened() && !isV2NewSessionPage())
  const desktopFileTreeOpen = createMemo(() => isDesktop() && layout.fileTree.opened() && !isV2NewSessionPage())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const info = createMemo(() => (currentSessionID() ? sync().session.get(currentSessionID()!) : undefined))
  const isChildSession = createMemo(() => !!info()?.parentID)
  const diffs = createMemo(() => (currentSessionID() ? list(sync().data.session_diff[currentSessionID()!]) : []))
  const canReview = createMemo(() => !!sync().project)
  const reviewTab = createMemo(() => isDesktop())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (currentSessionID() ? (sync().data.message[currentSessionID()!] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = currentSessionID()
    if (!id) return true
    return sync().data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = currentSessionID()
    if (!id) return false
    return sync().session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = currentSessionID()
    if (!id) return false
    return sync().session.history.loading(id)
  })
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  const owner = getOwner()
  const followupCache = createScopedCache(
    (_key: ScopedKey, scope: { server: ReturnType<typeof serverSDK>["scope"]; directory: string }) =>
      createRoot((dispose) => ({
        value: persisted(
          Persist.serverWorkspace(scope.server, scope.directory, "followup", ["followup.v1"]),
          createStore<FollowupState>({ items: {}, failed: {}, paused: {}, edit: {} }),
        ),
        dispose,
      }), owner),
    { dispose: (entry) => entry.dispose() },
  )
  onCleanup(() => followupCache.clear())
  const followupState = createMemo(() => {
    const scope = { server: serverSDK().scope, directory: sdk().directory }
    return followupCache.get(ScopedKey.from(scope.server, scope.directory, "followup"), scope).value
  })
  const followup = () => followupState()[0]
  const followupActions = {
    pause(sessionID: string, value?: boolean) {
      followupState()[1]("paused", sessionID, value)
    },
    fail(sessionID: string, value?: string | ((current: string | undefined) => string | undefined)) {
      followupState()[1]("failed", sessionID, value)
    },
    edit(sessionID: string, value?: FollowupEdit) {
      followupState()[1]("edit", sessionID, value)
    },
    remove(sessionID: string, id: string) {
      followupState()[1]("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    },
    queue(draft: FollowupDraft) {
      followupState()[1]("items", draft.sessionID, (items) => [
        ...(items ?? []),
        { id: Identifier.ascending("message"), ...draft },
      ])
      this.fail(draft.sessionID)
      this.pause(draft.sessionID)
    },
  }

  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    const state = sessionState()
    state.setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      state.setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => {
    const project = sync().project
    return !!project && project.vcs !== "git"
  })
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    const current = sync()
    if (current.project?.vcs === "git") list.push("git")
    if (
      current.project?.vcs === "git" &&
      current.data.vcs?.branch &&
      current.data.vcs?.default_branch &&
      current.data.vcs.branch !== current.data.vcs.default_branch
    ) {
      list.push("branch")
    }
    list.push("turn")
    return list
  })
  const mobileChanges = createMemo(() => !isDesktop() && sessionState().store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : sessionState().store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    const changes = sessionState().store.changes
    if (changes === "git" || changes === "branch") return changes
  })
  const vcsKey = createMemo(
    () => ["session-vcs", serverSDK().scope, sdk().directory, sync().data.vcs?.branch ?? "", sync().data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync().project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      queryFn: mode
        ? () =>
            sdk().client.vcs
              .diff({ mode })
              .then((result) => list(result.data))
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = debounce(() => void queryClient.invalidateQueries({ queryKey: vcsKey() }), 100)
  const reviewDiffs = () => {
    if (sessionState().store.changes === "git" || sessionState().store.changes === "branch")
      // avoids suspense
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (sessionState().store.changes === "git" || sessionState().store.changes === "branch") return !vcsQuery.isPending
    return true
  }

  const newSessionWorktree = createMemo(() => {
    if (sessionState().store.newSessionWorktree === "create") return "create"
    const project = sync().project
    if (project && sdk().directory !== project.worktree) return sdk().directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    sessionState().setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return sessionState().store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? sessionState().store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const messageId = sessionState().store.messageId
    const current = messageId && messageMark === scrollMark ? messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  function upsert(next: Project, current: ReturnType<typeof serverSync>, directorySync: ReturnType<typeof sync>) {
    const list = current.data.project
    directorySync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      current.set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      current.set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    current.set("project", [...list, next])
  }

  const gitMutation = useMutation(() => ({
    mutationFn: async () => {
      const currentServerSync = serverSync()
      const currentSync = sync()
      const x = await sdk().client.project.initGit()
      if (!x.data) return
      upsert(x.data, currentServerSync, currentSync)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let revealMessage = (_id: string) => {}
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    sessionState().setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - sessionState().ui.scrollGesture < scrollGestureWindowMs

  const [sessionSync] = createResource(
    () => [serverSDK().scope, sdk().directory, currentSessionID(), sync()] as const,
    ([scope, directory, id, current]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      const cached = untrack(() => current.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(scope, directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (serverSDK().scope !== scope || sdk().directory !== directory || currentSessionID() !== id) return
          untrack(() => {
            if (stale) void current.session.sync(id, { force: true })
          })
        }, 0)
      })

      return current.session.sync(id)
    },
  )

  createEffect(
    on(
      () => {
        const id = currentSessionID()
        return [
          serverSDK().scope,
          sdk().directory,
          id,
          id ? (sync().data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([scope, dir, id, status, blocked]) => {
        const current = sync()
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (status === "idle" && !blocked) return
        const cached = untrack(() => current.data.todo[id] !== undefined || serverSync().data.session_todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (serverSDK().scope !== scope || sdk().directory !== dir || currentSessionID() !== id) return
            untrack(() => {
              void current.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          sessionState().setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const stop = sdk().event.listen((evt) => {
      if (evt.details.type !== "file.watcher.updated") return
      const props =
        typeof evt.details.properties === "object" && evt.details.properties
          ? (evt.details.properties as Record<string, unknown>)
          : undefined
      const file = typeof props?.file === "string" ? props.file : undefined
      if (!file || file.startsWith(".git/")) return
      refreshVcs()
    })
    onCleanup(stop)
  })

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && shouldFocusTerminalOnKeyDown(event) && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked() || isChildSession()) return
      inputRef?.focus()
    }
  }

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(sessionState().store.changes)) return
    const next = list[0]
    if (!next) return
    sessionState().setStore("changes", next)
  })

  createEffect(
    on(
      () => sync().data.session_status[currentSessionID() ?? ""]?.type,
      (next, prev) => {
        if (next !== "idle" || prev === undefined || prev === "idle") return
        refreshVcs()
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  let reviewScroll: HTMLDivElement | undefined

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => {
    if (isChildSession()) return
    inputRef?.focus()
  }

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ChangeMode) => {
      if (option === "git") return language.t("ui.sessionReview.title.git")
      if (option === "branch") return language.t("ui.sessionReview.title.branch")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={changesOptions()}
        current={sessionState().store.changes}
        label={label}
        onSelect={(option) => option && sessionState().setStore("changes", option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const createGit = (input: { emptyClass: string }) => (
    <div class={input.emptyClass}>
      <div class="flex flex-col gap-3">
        <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
        <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
          {language.t("session.review.noVcs.createGit.description")}
        </div>
      </div>
      <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
        {gitMutation.isPending
          ? language.t("session.review.noVcs.createGit.actionLoading")
          : language.t("session.review.noVcs.createGit.action")}
      </Button>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (sessionState().store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (sessionState().store.changes === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (sessionState().store.changes === "git" || sessionState().store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (sessionState().store.changes === "turn") {
      if (nogit()) return createGit(input)
      return empty(reviewEmptyText())
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <SessionReviewTab
      title={changesTitle()}
      empty={reviewEmpty(input)}
      diffs={reviewDiffs}
      view={view}
      diffStyle={input.diffStyle}
      onDiffStyleChange={input.onDiffStyleChange}
      onScrollRef={(el) => {
        reviewScroll = el
      }}
      focusedFile={sessionState().store.activeDiff}
      onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
      onLineCommentUpdate={updateCommentInContext}
      onLineCommentDelete={removeCommentFromContext}
      lineCommentActions={reviewCommentActions()}
      commentMentions={{
        items: file.searchFilesAndDirectories,
      }}
      comments={comments.all()}
      focusedComment={comments.focus()}
      onFocusedCommentChange={comments.setFocus}
      onViewFile={openReviewFile}
      classes={input.classes}
    />
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    sessionState().setStore({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const state = sessionState()
    const pending = state.store.pendingDiff
    if (!pending) return
    if (!reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (sessionState() !== state) return
      if (state.store.pendingDiff !== pending) return
      if (count > 60) {
        state.setStore("pendingDiff", undefined)
        return
      }

      const root = reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        state.setStore("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  createEffect(() => {
    const id = currentSessionID()
    if (!id) return

    if (!wantsReview()) return
    if (sync().data.session_diff[id] !== undefined) return
    if (sync().status === "loading") return

    void sync().session.diff(id)
  })

  createEffect(
    on(
      () => [sessionKey(), wantsReview()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = currentSessionID()
        if (!id) return
        if (!untrack(() => sync().data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync().session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk().directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync().status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk().directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let scrollStateSession: ReturnType<typeof createPageSessionState> | undefined
  let fillFrame: number | undefined

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement, state: ReturnType<typeof createPageSessionState>) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (
      state.ui.scroll.overflow === overflow &&
      state.ui.scroll.bottom === bottom &&
      state.ui.scroll.jump === jump &&
      state.ui.scroll.top === el.scrollTop
    )
      return
    state.setUi("scroll", { overflow, bottom, jump, top: el.scrollTop })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    scrollStateSession = sessionState()
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      const state = scrollStateSession
      scrollStateTarget = undefined
      scrollStateSession = undefined
      if (!target || !state) return

      updateScrollState(target, state)
    })
  }

  const resumeScroll = () => {
    sessionState().setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        sessionState().setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  let restoreScrollFrame: number | undefined
  createEffect(
    on(
      sessionKey,
      () => {
        if (restoreScrollFrame !== undefined) cancelAnimationFrame(restoreScrollFrame)
        restoreScrollFrame = requestAnimationFrame(() => {
          restoreScrollFrame = undefined
          const el = scroller
          if (!el) return
          const scroll = sessionState().ui.scroll
          if (scroll.bottom) {
            autoScroll.forceScrollToBottom()
          } else {
            el.scrollTop = scroll.top
            autoScroll.handleScroll()
          }
          scheduleScrollState(el)
        })
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    if (restoreScrollFrame !== undefined) cancelAnimationFrame(restoreScrollFrame)
  })

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const historyLoader = createSessionHistoryLoader({
    sessionID: currentSessionID,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync().session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!currentSessionID() || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (!historyMore()) return

      void historyLoader.loadAndReveal()
    })
  }

  createEffect(
    on(
      () =>
        [
          currentSessionID(),
          messagesReady(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (!more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync().data.part[id] ?? [], {
      directory: sdk().directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const busy = (sessionID: string) => sync().data.session_working(sessionID)

  const queuedFollowups = createMemo(() => {
    const id = currentSessionID()
    if (!id) return emptyFollowups
    return followup().items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = currentSessionID()
    if (!id) return
    return followup().edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; id: string; manual?: boolean }) => {
      const current = sdk()
      const currentSync = sync()
      const currentServerSync = serverSync()
      const [currentFollowup, setCurrentFollowup] = followupState()
      const currentSessionKey = sessionKey()
      const item = (currentFollowup.items[input.sessionID] ?? []).find((entry) => entry.id === input.id)
      if (!item) return

      if (input.manual) setCurrentFollowup("paused", input.sessionID, undefined)
      setCurrentFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: current.client,
        sync: currentSync,
        serverSync: currentServerSync,
        draft: item,
        optimisticBusy: item.sessionDirectory === current.directory,
      }).catch((err) => {
        setCurrentFollowup("failed", input.sessionID, input.id)
        fail(err)
        return false
      })
      if (!ok) return

      setCurrentFollowup("items", input.sessionID, (items) => (items ?? []).filter((entry) => entry.id !== input.id))
      if (input.manual && sessionKey() === currentSessionKey) resumeScroll()
    },
  }))

  const followupBusy = (sessionID: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sessionID

  const sendingFollowup = createMemo(() => {
    const id = currentSessionID()
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.id
  })

  const queueEnabled = createMemo(() => {
    const id = currentSessionID()
    if (!id) return false
    return settings.general.followup() === "queue" && busy(id) && !composer.blocked() && !isChildSession()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    followupActions.queue(draft)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    if (sync().session.get(sessionID)?.parentID) return Promise.resolve()
    const item = (followup().items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followupBusy(sessionID)) return Promise.resolve()

    return followupMutation.mutateAsync({ sessionID, id, manual: opts?.manual })
  }

  const editFollowup = (id: string) => {
    const sessionID = currentSessionID()
    if (!sessionID) return
    if (followupBusy(sessionID)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    followupActions.remove(sessionID, id)
    followupActions.fail(sessionID, (value) => (value === id ? undefined : value))
    followupActions.edit(sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = currentSessionID()
    if (!id) return
    followupActions.edit(id)
  }

  const halt = (current: ReturnType<typeof sdk>, currentSync: ReturnType<typeof sync>, sessionID: string) =>
    currentSync.data.session_working(sessionID)
      ? current.client.session.abort({ sessionID }).catch(() => {})
      : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const current = sdk()
      const currentSync = sync()
      const currentPrompt = prompt.bind()
      const currentInfo = currentSync.session.get(input.sessionID)
      const prev = currentPrompt.current().slice()
      const last = currentInfo?.revert
      const value = extractPromptFromParts(currentSync.data.part[input.messageID] ?? [], {
        directory: current.directory,
        attachmentName: language.t("common.attachment"),
      })
      const rollCurrent = (next: NonNullable<ReturnType<typeof info>>["revert"]) =>
        currentSync.set("session", (list) =>
          list.map((item) => (item.id === input.sessionID ? { ...item, revert: next } : item)),
        )
      batch(() => {
        rollCurrent({ messageID: input.messageID })
        currentPrompt.set(value)
      })
      await halt(current, currentSync, input.sessionID)
        .then(() => current.client.session.revert(input))
        .then((result) => {
          if (result.data) {
            currentSync.set("session", (list) => list.map((item) => (item.id === result.data!.id ? result.data! : item)))
          }
        })
        .catch((err) => {
          batch(() => {
            rollCurrent(last)
            currentPrompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = currentSessionID()
      if (!sessionID) return

      const current = sdk()
      const currentSync = sync()
      const currentPrompt = prompt.bind()
      const next = currentSync.data.message[sessionID]?.filter((item) => item.role === "user").find((item) => item.id > id)
      const prev = currentPrompt.current().slice()
      const last = currentSync.session.get(sessionID)?.revert
      const rollCurrent = (revert: NonNullable<ReturnType<typeof info>>["revert"]) =>
        currentSync.set("session", (list) =>
          list.map((item) => (item.id === sessionID ? { ...item, revert } : item)),
        )

      batch(() => {
        rollCurrent(next ? { messageID: next.id } : undefined)
        if (next) {
          currentPrompt.set(
            extractPromptFromParts(currentSync.data.part[next.id] ?? [], {
              directory: current.directory,
              attachmentName: language.t("common.attachment"),
            }),
          )
          return
        }
        currentPrompt.reset()
      })

      const task = !next
        ? halt(current, currentSync, sessionID).then(() => current.client.session.unrevert({ sessionID }))
        : halt(current, currentSync, sessionID).then(() =>
            current.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) {
            currentSync.set("session", (list) => list.map((item) => (item.id === result.data!.id ? result.data! : item)))
          }
        })
        .catch((err) => {
          batch(() => {
            rollCurrent(last)
            currentPrompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!currentSessionID() || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { revert }

  createEffect(() => {
    const sessionID = currentSessionID()
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(sessionID)) return
    if (followup().failed[sessionID] === item.id) return
    if (followup().paused[sessionID]) return
    if (isChildSession()) return
    if (composer.blocked()) return
    if (busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: currentSessionID,
    messagesReady,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync().session.history.loadMore(sessionID),
    currentMessageId: () => sessionState().store.messageId,
    pendingMessage: () => sessionState().ui.pendingMessage,
    setPendingMessage: (value) => sessionState().setUi("pendingMessage", value),
    setActiveMessage,
    autoScroll,
    scroller: () => scroller,
    anchor,
    revealMessage: (id) => revealMessage(id),
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  createEffect(
    on(
      currentSessionID,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
  })

  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  useUsageExceededDialogs()

  const composerRegion = (placement: "dock" | "inline") => (
    <SessionComposerRegion
      state={composer}
      ready={messagesReady()}
      centered={placement === "dock" && centered()}
      placement={placement}
      inputRef={(el) => {
        inputRef = el
      }}
      newSessionWorktree={newSessionWorktree()}
      onNewSessionWorktreeReset={() => sessionState().setStore("newSessionWorktree", "main")}
      onSubmit={() => {
        comments.clear()
        resumeScroll()
      }}
      onResponseSubmit={resumeScroll}
      followup={
        currentSessionID() && !isChildSession()
          ? {
              queue: queueEnabled,
              items: followupDock(),
              sending: sendingFollowup(),
              edit: editingFollowup(),
              onQueue: queueFollowup,
              onAbort: () => {
                const id = currentSessionID()
                if (!id) return
                followupActions.pause(id, true)
              },
              onSend: (id) => {
                void sendFollowup(currentSessionID()!, id, { manual: true })
              },
              onEdit: editFollowup,
              onEditLoaded: clearFollowupEdit,
            }
          : undefined
      }
      revert={
        rolled().length > 0
          ? {
              items: rolled(),
              restoring: restoring(),
              disabled: reverting(),
              onRestore: restore,
            }
          : undefined
      }
      setPromptDockRef={(el) => {
        promptDock = el
      }}
    />
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {sessionSync() ?? ""}
      <SessionHeader />
      <div
        class="flex-1 min-h-0 flex flex-col md:flex-row "
        classList={{
          "gap-2 p-2": settings.general.newLayoutDesigns(),
        }}
      >
        <Show when={!isDesktop() && !!currentSessionID()}>
          <Tabs value={sessionState().store.mobileTab} class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="!w-1/2 !max-w-none"
                classes={{ button: "w-full" }}
                onClick={() => sessionState().setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="!w-1/2 !max-w-none !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => sessionState().setStore("mobileTab", "changes")}
              >
                {hasReview()
                  ? language.t("session.review.filesChanged", { count: reviewCount() })
                  : language.t("session.review.change.other")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
            "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !sessionState().ui.reviewSnap,
            "transition-[width]": !isV2NewSessionPage(),
            "rounded-[10px] shadow-[var(--v2-elevation-raised)]": settings.general.newLayoutDesigns() && !!currentSessionID(),
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div
            class="flex-1 min-h-0 overflow-hidden"
            classList={{
              "rounded-[10px]": settings.general.newLayoutDesigns(),
            }}
          >
            <Switch>
              <Match when={currentSessionID() && mobileChanges()}>
                <div class="relative h-full overflow-hidden">
                  {reviewContent({
                    diffStyle: "unified",
                    classes: {
                      root: "pb-8",
                      header: "px-4",
                      container: "px-4",
                    },
                    loadingClass: "px-4 py-4 text-text-weak",
                    emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                  })}
                </div>
              </Match>
              <Match when={currentSessionID()}>
                <MessageTimeline
                  actions={actions}
                  scroll={sessionState().ui.scroll}
                  onResumeScroll={resumeScroll}
                  setScrollRef={setScrollRef}
                  onScheduleScrollState={scheduleScrollState}
                  onAutoScrollHandleScroll={autoScroll.handleScroll}
                  onMarkScrollGesture={markScrollGesture}
                  hasScrollGesture={hasScrollGesture}
                  onUserScroll={markUserScroll}
                  onHistoryScroll={historyLoader.onScrollerScroll}
                  onAutoScrollInteraction={autoScroll.handleInteraction}
                  shouldAnchorBottom={() =>
                    !location.hash &&
                    !sessionState().store.messageId &&
                    !sessionState().ui.pendingMessage &&
                    !autoScroll.userScrolled()
                  }
                  centered={centered()}
                  setContentRef={(el) => {
                    content = el
                    autoScroll.contentRef(el)

                    const root = scroller
                    if (root) scheduleScrollState(root)
                  }}
                  historyShift={historyLoader.shift()}
                  userMessages={historyLoader.userMessages()}
                  anchor={anchor}
                  setRevealMessage={(fn) => {
                    revealMessage = fn
                  }}
                />
              </Match>
              <Match when={true}>
                <Show when={newSessionDesign()} fallback={<NewSessionView worktree={newSessionWorktree()} />}>
                  <NewSessionDesignView>{composerRegion("inline")}</NewSessionDesignView>
                </Show>
              </Match>
            </Switch>
          </div>

          <Show when={currentSessionID() || !newSessionDesign()}>{composerRegion("dock")}</Show>

          <Show when={desktopReviewOpen()}>
            <div onPointerDown={() => size.start()}>
              <ResizeHandle
                classList={{
                  "-right-1": settings.general.newLayoutDesigns(),
                }}
                direction="horizontal"
                size={layout.session.width()}
                min={450}
                max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <SessionSidePanel
          canReview={canReview}
          diffs={reviewDiffs}
          diffsReady={reviewReady}
          empty={reviewEmptyText}
          hasReview={hasReview}
          reviewCount={reviewCount}
          reviewPanel={reviewPanel}
          activeDiff={sessionState().store.activeDiff}
          focusReviewDiff={focusReviewDiff}
          reviewSnap={sessionState().ui.reviewSnap}
          size={size}
        />
      </div>

      <TerminalPanel />
    </div>
  )
}

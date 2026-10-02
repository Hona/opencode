import { batch, createRoot, createSignal, getOwner, lazy, onCleanup, Show, Suspense, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  createKeyed,
  Layout,
  LinkHandler,
  Panel,
  Sessions,
  usePanel,
  type PanelTab,
  type SessionRef,
  type MountedSession,
  type Setup,
  onIdle,
} from "../sdk"
import { Changes, type ChangeKind } from "./contract"
import type Review from "./index"
import { createReviewModel, type Demand, type ReviewModel } from "./model"

const TAB = "changes"

const KEY = `review:${TAB}`

const setup: Setup<typeof Review> = (ctx) => {
  const owner = getOwner()
  const sessions = ctx.use(Sessions)
  const layout = ctx.use(Layout)
  const diff = ctx.stores.diff
  const panel = ctx.stores.panel

  // Who shows a view's changes: the review render, the file tree, and file tabs. A view follows its route,
  // so a session switch keeps the demand.
  const demands = new WeakMap<MountedSession, ReturnType<typeof createStore<Demand>>>()

  const demand = (view: MountedSession) => {
    const existing = demands.get(view)

    if (existing) return existing

    const created = createStore<Demand>({ tree: 0, files: 0, panel: 0, details: 0 })

    demands.set(view, created)

    return created
  }

  const watch = (view: MountedSession, source: keyof Demand) => {
    const set = demand(view)[1]

    set(source, (count) => count + 1)

    return () => set(source, (count) => Math.max(0, count - 1))
  }

  // One review model for the routed session screen, like the review the screen created before extensions.
  const [entry, setEntry] = createSignal<{ view: MountedSession; model: ReviewModel; dispose: () => void }>()

  createKeyed(
    () => sessions.current(),
    (view) => {
      const current = untrack(entry)

      if (current?.view === view) return

      current?.dispose()
      setEntry(
        createRoot(
          (dispose) => ({
            view,
            model: createReviewModel({ ctx, view, demand: demand(view)[0] }),
            dispose,
          }),
          owner,
        ),
      )
    },
    {
      // A session switch unmounts and remounts the routed view in one update; keep the model through it.
      otherwise: () => {
        const current = untrack(entry)

        queueMicrotask(() => {
          if (sessions.current() || untrack(entry) !== current) return

          current?.dispose()
          setEntry(undefined)
        })
      },
    },
  )
  onCleanup(() => untrack(entry)?.dispose())

  const modelFor = (session: SessionRef) => {
    const current = entry()

    return current && current.view.key === session.key ? current.model : undefined
  }

  const tabs = new WeakMap<MountedSession, PanelTab>()

  const tab = (session: MountedSession) => {
    const existing = tabs.get(session)

    if (existing) return existing

    const count = () => modelFor(session)?.count() ?? 0

    const created: PanelTab = {
      id: TAB,
      get title() {
        return count() > 0 ? ctx.plural("tab.count", count()) : ctx.t("tab.title")
      },
      kind: "pinned",
      // Without focusable content the panel itself joins the tab order.
      get tabbable() {
        return !(count() > 0 || layout.sidebar.opened())
      },
      fallback: 1,
      dom: { tab: "session-side-panel-review-tab", panel: "session-side-panel-review-tabpanel" },
    }

    tabs.set(session, created)

    return created
  }

  const ReviewPanel = lazy(() => import("./panel"))
  const MobileReview = lazy(() => import("./mobile"))

  ctx.cleanup(onIdle(() => void (layout.narrow() ? MobileReview : ReviewPanel).preload()))

  ctx.add(Panel, {
    id: "main",
    region: "side",
    // The split diff needs the wider session minimum while the side region is open.
    get wide() {
      return diff.value.diffStyle === "split"
    },
    // The review tab is pinned, never stored; a stored key, such as one from before extensions, leaves the strip.
    transient: true,
    legacy: { review: TAB },
    mobile: {
      get title() {
        return ctx.plural("mobile.title", 0)
      },
      order: 10,
      kind: "tab",
    },
    list: (session) => (!layout.narrow() && session.project ? [tab(session)] : []),
    render: (_tab, session) => {
      const frame = usePanel()

      return (
        <Show when={modelFor(session)} keyed>
          {(model) => {
            createKeyed(frame.visible, () => onCleanup(watch(session, "panel")))

            return (
              <Show
                when={frame.placement() === "mobile"}
                fallback={
                  <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
                    <Show when={model.panelRendered()}>
                      <Suspense>
                        <ReviewPanel
                          review={model}
                          session={session}
                          diffStyle={diff.value.diffStyle}
                          onDiffStyleChange={(style) =>
                            diff.update((draft) => {
                              draft.diffStyle = style
                            })
                          }
                          expandMode={panel.value.expandMode}
                          onExpandModeChange={(mode) =>
                            panel.update((draft) => {
                              draft.expandMode = mode
                            })
                          }
                        />
                      </Suspense>
                    </Show>
                  </div>
                }
              >
                <Suspense>
                  <MobileReview review={model} session={session} />
                </Suspense>
              </Show>
            )
          }}
        </Show>
      )
    },
  })

  const reveals = new Set<() => void>()

  // A review comment in the composer reveals its diff.
  ctx.add(LinkHandler, {
    priority: 1,
    match: (link) => link.origin === "review",
    open(link) {
      const session = sessions.current()

      if (!session || (link.session && link.session.key !== session.key)) return

      batch(() => {
        // Narrow screens keep their view, as they did before extensions.
        if (!layout.narrow() && session.project) layout.open(KEY, session)

        reveals.forEach((listener) => listener())
        modelFor(session)?.focusFile(link.href)
      })
    },
  })

  const none: readonly FileDiffInfo[] = []
  const noKinds: ReadonlyMap<string, ChangeKind> = new Map()

  ctx.provide(Changes, {
    diffs: (session) => modelFor(session)?.diffs() ?? none,
    ready: (session) => modelFor(session)?.ready() ?? false,
    kinds: (session) => modelFor(session)?.kinds() ?? noKinds,
    active: (session) => modelFor(session)?.activeFile(),
    details: (session) => modelFor(session)?.details(),
    focus: (session, path) => modelFor(session)?.focusFile(path),
    open(session) {
      // The summary's changes row: narrow screens switch to the Changes view; wide ones open the side region.
      if (layout.narrow()) return layout.open(KEY, session)

      if (!layout.side.opened(session)) layout.side.toggle(session)
    },
    watch: (session, source) => watch(session, source),
    onReveal(listener) {
      reveals.add(listener)

      return () => {
        reveals.delete(listener)
      }
    },
  })
}

export default setup

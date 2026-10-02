import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { onIdle, Panel, Slot, usePanel, type PanelTab, type MountedSession, type Setup } from "../sdk"
import type Usage from "./index"
import { SessionContextUsage } from "./indicator"

const setup: Setup<typeof Usage> = (ctx) => {
  const SessionContextTab = lazy(() => import("./tab"))
  // Compile the tab while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionContextTab.preload()))
  // One tab object per mounted session, so strip updates never remount its trigger.
  const tabs = new WeakMap<MountedSession, PanelTab>()

  const tab = (session: MountedSession) => {
    const existing = tabs.get(session)

    if (existing) return existing

    const created: PanelTab = {
      id: "context",
      get title() {
        return ctx.t("tab.title")
      },
      draggable: false,
      closable: "compact",
      first: true,
      fallback: 2,
      label: () => (
        <div class="flex items-center gap-2">
          <SessionContextUsage session={session} variant="indicator" />
          <div>{ctx.t("tab.title")}</div>
        </div>
      ),
    }

    tabs.set(session, created)

    return created
  }

  ctx.add(Slot, {
    at: "session.header",
    order: 10,
    render: (input) => <SessionContextUsage session={input.session} placement="bottom" />,
  })

  ctx.add(
    Panel,
    (): Panel => ({
      id: "main",
      region: "side",
      legacy: { context: "context" },
      mobile: { title: ctx.t("mobile.title"), order: 10, kind: "menu" },
      list: (session, open) => (open.includes("context") ? [tab(session)] : []),
      render: (_tab, session) => {
        const panel = usePanel()

        return (
          <Show
            when={panel.placement() !== "mobile"}
            fallback={
              <Suspense>
                <SessionContextTab session={session} />
              </Suspense>
            }
          >
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <Suspense>
                <SessionContextTab session={session} />
              </Suspense>
            </div>
          </Show>
        )
      },
    }),
  )
}

export default setup

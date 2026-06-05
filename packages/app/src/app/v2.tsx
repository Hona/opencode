import { ServerProviders, SessionProviders } from "@/app/route-providers"
import { DebugBar } from "@/components/debug-bar"
import { TitlebarV2 } from "@/components/titlebar-v2"
import { DirectoryProvider, type DirectoryState } from "@/context/directory"
import { useGlobal } from "@/context/global"
import { NavigationProvider, type Navigation } from "@/context/navigation"
import { RouteProvider, type AppRoute } from "@/context/route"
import { type ServerContext, ServerContextProvider } from "@/context/server-context"
import { TabsProvider, useTabs } from "@/context/tabs"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { ErrorPage } from "@/pages/error"
import { ToastRegion } from "@/utils/toast"
import { requireServerKey, rootSession, sessionHref, sessionQuery } from "@/utils/v2-route"
import type { Session as SessionInfo } from "@opencode-ai/sdk/v2/client"
import { Splash } from "@opencode-ai/ui/logo"
import { type BaseRouterProps, Route, Router, useParams, useSearchParams } from "@solidjs/router"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/solid-query"
import { type Accessor, type Component, createMemo, lazy, Match, onMount, type ParentProps, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"

const Home = lazy(() => import("@/pages/home").then((module) => ({ default: module.V2Home })))
const Session = lazy(() => import("@/pages/session"))

const SessionRoute = Object.assign(
  () => (
    <SessionProviders>
      <Session />
    </SessionProviders>
  ),
  { preload: Session.preload },
)

function V2Shell(props: ParentProps) {
  return (
    <div class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <TitlebarV2 />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">{props.children}</main>
      {import.meta.env.DEV && <DebugBar />}
      <ToastRegion v2 />
    </div>
  )
}

function HomeRoute() {
  const global = useGlobal()
  return (
    <RouteProvider route={() => ({ type: "home" })}>
      <ServerContextProvider value={global.servers.first}>
        <ServerProviders directory={() => undefined} sessionID={() => undefined}>
          <V2Shell>
            <Home />
          </V2Shell>
        </ServerProviders>
      </ServerContextProvider>
    </RouteProvider>
  )
}

function DraftRoute() {
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  return (
    <Show when={tabs.ready()} fallback={<RouteLoading />}>
      <ReadyDraftRoute draftID={search.draftId} />
    </Show>
  )
}

function ReadyDraftRoute(props: { draftID?: string }) {
  const global = useGlobal()
  const tabs = useTabs()
  const resolved = createMemo(() => {
    const draftID = props.draftID
    if (!draftID) throw new Error("Draft route requires a draft ID")
    const draft = tabs.draft(draftID)
    return { draftID, draft, server: global.servers.get(draft.server) }
  })
  const route = createMemo<AppRoute>(() => {
    const current = resolved()!
    return {
      type: "draft",
      draftID: current.draftID,
      server: current.draft.server,
      directory: current.draft.directory,
    }
  })
  const navigation = createMemo<Navigation>(() => {
    const current = resolved()
    return {
      session: (sessionID) => sessionHref(current.draft.server, sessionID),
      newSession: () => tabs.newDraft({ server: current.draft.server, directory: current.draft.directory }),
      openSession: (sessionID) => tabs.openSession(current.draft.server, sessionID),
      selectDirectory: (directory) => tabs.updateDraft(current.draftID, { directory }),
      created: (session) => {
        tabs.promoteDraft(current.draftID, { server: current.draft.server, sessionId: session.id })
      },
    }
  })

  return (
    <V2DirectoryRoute
      route={route}
      server={() => resolved().server}
      directory={() => resolved().draft.directory}
      sessionID={() => undefined}
      state={() => ({ type: "draft", id: resolved().draftID })}
      navigation={navigation}
    />
  )
}

type ResolvedServer = { id: string; ctx: ServerContext }
type ResolvedSession = { server: ServerContext; session: SessionInfo; tabID: string }

function SessionRouteResolver() {
  const params = useParams<{ serverKey: string; id: string }>()
  const global = useGlobal()
  const queryClient = useQueryClient()
  const resolved = createMemo<ResolvedServer>(() => {
    const key = requireServerKey(params.serverKey)
    return { id: params.id, ctx: global.servers.get(key) }
  })
  const session = useQuery(() => {
    const server = resolved()
    return {
      queryKey: ["v2", "resolved-session", server.ctx.key, server.ctx.instance, server.id] as const,
      placeholderData: keepPreviousData,
      queryFn: async () => {
        const locator = await queryClient.ensureQueryData(
          sessionQuery(server.ctx.key, server.ctx.instance, server.ctx.sdk, server.id),
        )
        const root = await rootSession(locator.session, (id) =>
          queryClient
            .ensureQueryData(sessionQuery(server.ctx.key, server.ctx.instance, server.ctx.sdk, id))
            .then((result) => result.session),
        )
        return { server: server.ctx, session: locator.session, tabID: root.id }
      },
    }
  })
  return (
    <Show
      when={session.data}
      fallback={
        <Show when={session.error} fallback={<RouteLoading />}>
          {(error) => <ErrorPage error={error()} />}
        </Show>
      }
    >
      {(current) => (
        <>
          <ResolvedSessionRoute resolved={current} />
          <Show when={session.isPlaceholderData}>
            <RouteLoading overlay />
          </Show>
        </>
      )}
    </Show>
  )
}

function RouteLoading(props: { overlay?: boolean }) {
  return (
    <div
      class="h-dvh w-screen flex items-center justify-center bg-v2-background-bg-deep"
      classList={{ "fixed inset-0 z-50": props.overlay }}
    >
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}

function ResolvedSessionRoute(props: { resolved: Accessor<ResolvedSession> }) {
  const tabs = useTabs()
  const route = createMemo<AppRoute>(() => {
    const { server, session } = props.resolved()
    return {
      type: "session",
      server: server.key,
      directory: session.directory,
      sessionID: session.id,
      tabID: props.resolved().tabID,
    }
  })
  const navigation = createMemo<Navigation>(() => {
    const current = props.resolved()
    return {
      session: (sessionID) => sessionHref(current.server.key, sessionID),
      newSession: () => tabs.newDraft({ server: current.server.key, directory: current.session.directory }),
      openSession: (sessionID) => tabs.openSession(current.server.key, sessionID),
      selectDirectory: (directory) => tabs.newDraft({ server: current.server.key, directory }),
      created: (session) => tabs.openSession(current.server.key, session.id),
    }
  })
  return (
    <>
      <Show when={props.resolved()} keyed>
        {(resolved) => <SessionAdmission server={resolved.server} sessionID={resolved.tabID} />}
      </Show>
      <V2DirectoryRoute
        route={route}
        server={() => props.resolved().server}
        directory={() => props.resolved().session.directory}
        sessionID={() => props.resolved().session.id}
        state={() => ({ type: "session", id: props.resolved().session.id })}
        navigation={navigation}
      />
    </>
  )
}

function SessionAdmission(props: { server: ServerContext; sessionID: string }) {
  const tabs = useTabs()
  onMount(() => tabs.admitSession({ server: props.server.key, sessionId: props.sessionID }))
  return null
}

function V2DirectoryRoute(props: {
  route: Accessor<AppRoute>
  server: Accessor<ServerContext>
  directory: Accessor<string>
  sessionID: Accessor<string | undefined>
  state: Accessor<DirectoryState>
  navigation: Accessor<Navigation>
}) {
  return (
    <RouteProvider route={props.route}>
      <ServerContextProvider value={props.server}>
        <NavigationProvider value={props.navigation}>
          <ServerProviders directory={props.directory} sessionID={props.sessionID}>
            <V2Shell>
              <DirectoryProvider directory={props.directory} sessionID={props.sessionID} state={props.state}>
                <DirectoryDataProvider directory={props.directory()}>
                  <SessionRoute />
                </DirectoryDataProvider>
              </DirectoryProvider>
            </V2Shell>
          </ServerProviders>
        </NavigationProvider>
      </ServerContextProvider>
    </RouteProvider>
  )
}

export function V2Root(props: { router?: Component<BaseRouterProps> }) {
  return (
    <Dynamic component={props.router ?? Router} root={(routerProps) => <TabsProvider>{routerProps.children}</TabsProvider>}>
      <Route path="/" component={HomeRoute} />
      <Route path="/new-session" component={DraftRoute} />
      <Route path="/server/:serverKey/session/:id" component={SessionRouteResolver} />
    </Dynamic>
  )
}

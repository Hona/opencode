import { ServerProviders, SessionProviders } from "@/app/route-providers"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { ServerContextProvider } from "@/context/server-context"
import { TabsProvider } from "@/context/tabs"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { decode64 } from "@/utils/base64"
import { useCheckServerHealth } from "@/utils/server-health"
import { Splash } from "@opencode-ai/ui/logo"
import { type BaseRouterProps, Navigate, Route, Router, useParams } from "@solidjs/router"
import { Effect } from "effect"
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  lazy,
  onCleanup,
  type ParentProps,
  Show,
} from "solid-js"
import { Dynamic } from "solid-js/web"

const Home = lazy(() => import("@/pages/home").then((module) => ({ default: module.LegacyHome })))
const Session = lazy(() => import("@/pages/session"))

const SessionRoute = Object.assign(
  () => (
    <SessionProviders>
      <Session />
    </SessionProviders>
  ),
  { preload: Session.preload },
)

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )
  const checking = createMemo(
    () => checkMode() === "blocking" && ["unresolved", "pending"].includes(startupHealthCheck.state),
  )

  return (
    <Show
      when={!checking()}
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      <Show
        when={startupHealthCheck.latest}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

function LegacyShell(
  props: ParentProps<{
    directory: () => string | undefined
    sessionID: () => string | undefined
  }>,
) {
  return (
    <ServerProviders directory={props.directory} sessionID={props.sessionID}>
      <Layout>{props.children}</Layout>
    </ServerProviders>
  )
}

function LegacyProviders(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const params = useParams<{ dir?: string; id?: string }>()
  const server = useServer()
  const global = useGlobal()
  const directory = createMemo(() => (params.dir ? decode64(params.dir) : undefined))
  return (
    <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
      <ServerKey>
        <Show when={server.current} keyed>
          {(connection) => (
            <ServerContextProvider value={() => global.createServerCtx(connection)}>
              <LegacyShell
                directory={directory}
                sessionID={() => params.id}
              >
                {props.children}
              </LegacyShell>
            </ServerContextProvider>
          )}
        </Show>
      </ServerKey>
    </ConnectionGate>
  )
}

export function LegacyRoot(props: { router?: Component<BaseRouterProps>; disableHealthCheck?: boolean }) {
  return (
    <Dynamic
      component={props.router ?? Router}
      root={(routerProps) => (
        <TabsProvider>
          <LegacyProviders disableHealthCheck={props.disableHealthCheck}>{routerProps.children}</LegacyProviders>
        </TabsProvider>
      )}
    >
      <Route path="/" component={Home} />
      <Route path="/:dir" component={DirectoryLayout}>
        <Route path="/" component={() => <Navigate href="session" />} />
        <Route path="/session/:id?" component={SessionRoute} />
      </Route>
    </Dynamic>
  )
}

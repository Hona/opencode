import "@/index.css"
import { LegacyRoot } from "@/app/legacy"
import { V2Root } from "@/app/v2"
import { CommandProvider } from "@/context/command"
import { GlobalProvider } from "@/context/global"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, ServerProvider } from "@/context/server"
import { SettingsProvider, useSettings } from "@/context/settings"
import { NotificationServiceProvider } from "@/context/notification"
import { PermissionServiceProvider } from "@/context/permission"
import type { ServerContext } from "@/context/server-context"
import { sessionHref } from "@/utils/v2-route"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { ErrorPage } from "@/pages/error"
import { setV2Toast } from "@/utils/toast"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { File } from "@opencode-ai/ui/file"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import * as Sentry from "@sentry/solid"
import { MetaProvider } from "@solidjs/meta"
import type { BaseRouterProps } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { type Component, createEffect, ErrorBoundary, type JSX, type ParentProps, untrack } from "solid-js"

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      exportDebugLogs?: () => Promise<string>
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function BodyDesignClass() {
  const settings = useSettings()

  createEffect(() => {
    if (typeof document === "undefined") return

    const enabled = settings.general.newLayoutDesigns()
    setV2Toast(enabled)
    document.body.classList.toggle("text-12-regular", !enabled)
    document.body.classList.toggle("font-(family-name:--font-family-text)", enabled)
    document.body.classList.toggle("text-[13px]", enabled)
    document.body.classList.toggle("font-[440]", enabled)
  })

  return null
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <DialogProvider>
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function v2NotificationHref(server: ServerContext, _directory: string, sessionID?: string) {
  if (!sessionID) return "/"
  return sessionHref(server.key, sessionID)
}

function legacyNotificationHref(_server: ServerContext, directory: string, sessionID?: string) {
  if (!sessionID) return `/${base64Encode(directory)}`
  return `/${base64Encode(directory)}/session/${sessionID}`
}

function Application(props: ParentProps<{ router?: Component<BaseRouterProps>; disableHealthCheck?: boolean }>) {
  const platform = usePlatform()
  const settings = useSettings()
  const desktopV2 = platform.platform === "desktop" && untrack(settings.general.newLayoutDesigns)
  const href = desktopV2 ? v2NotificationHref : legacyNotificationHref
  return (
    <PermissionServiceProvider>
      <NotificationServiceProvider href={href}>
        {props.children}
        {desktopV2 ? (
          <V2Root router={props.router} />
        ) : (
          <LegacyRoot router={props.router} disableHealthCheck={props.disableHealthCheck} />
        )}
      </NotificationServiceProvider>
    </PermissionServiceProvider>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      canonicalLocalServer={props.canonicalLocalServer}
      servers={props.servers}
    >
      <SettingsProvider>
        <BodyDesignClass />
        <CommandProvider>
          <HighlightsProvider>
            <GlobalProvider>
              <Application router={props.router} disableHealthCheck={props.disableHealthCheck}>
                {props.children}
              </Application>
            </GlobalProvider>
          </HighlightsProvider>
        </CommandProvider>
      </SettingsProvider>
    </ServerProvider>
  )
}

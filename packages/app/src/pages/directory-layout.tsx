import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { DirectoryProvider, useSync } from "@/context/directory"
import { NavigationProvider, useNavigation, type Navigation } from "@/context/navigation"
import { decode64 } from "@/utils/base64"
import { Schema } from "effect"

export function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const navigation = useNavigation()
  const sync = useSync()

  return (
    <DataProvider
      data={sync().data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigation().openSession(sessionID)}
      onSessionHref={(sessionID) => navigation().session(sessionID)}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

function LegacyDirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))
  const navigation = createMemo<Navigation>(() => ({
      session: (sessionID) => `/${slug()}/session/${sessionID}`,
      newSession: () => navigate(`/${slug()}/session`),
      openSession: (sessionID) => navigate(`/${slug()}/session/${sessionID}`),
      selectDirectory: (directory) => navigate(`/${base64Encode(directory)}/session`),
      created: (session) => navigate(`/${base64Encode(session.directory)}/session/${session.id}`),
  }))

  createEffect(() => {
    const next = sync().data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  return (
    <NavigationProvider
      value={navigation}
    >
      <DirectoryDataProvider directory={props.directory}>{props.children}</DirectoryDataProvider>
    </NavigationProvider>
  )
}

export const ProjectDirString = Schema.String.pipe(Schema.brand("ProjectDirString"))
export type ProjectDirString = Schema.Schema.Type<typeof ProjectDirString>

export function decodeDirectory(dir: string): ProjectDirString | undefined {
  const decoded = decode64(dir)
  if (!decoded) return
  return ProjectDirString.make(decoded)
}

export default function Layout(props: ParentProps) {
  const params = useParams<{ dir?: string; id?: string }>()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <DirectoryProvider
          directory={() => resolved}
          sessionID={() => params.id}
          state={() => (params.id ? { type: "session", id: params.id } : { type: "workspace" })}
        >
          <LegacyDirectoryDataProvider directory={resolved}>{props.children}</LegacyDirectoryDataProvider>
        </DirectoryProvider>
      )}
    </Show>
  )
}

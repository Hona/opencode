import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { BackgroundTask, Comments, Composer, Files, LineRange, ServerRef, SessionView } from "@opencode/gui-extensions/sdk"
import { useComments } from "@/composer/comments"
import { useComposerState } from "@/composer/persistence"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import type { SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useExtensionAttachment } from "./services"

const noTasks: readonly BackgroundTask[] = []

/** The routed session as extensions see it. One stable object that follows the route. */
export function createSessionView(session: SessionModel) {
  const file = useFile()
  const comments = useComments()
  const composer = useComposerState()
  const server = useServer()
  const location = useWorkspaceLocation()
  const attachment = useExtensionAttachment()
  // The composer region owns background tasks and is created after the view.
  const [background, setBackground] = createSignal<Accessor<readonly BackgroundTask[]>>()

  const serverRef: ServerRef = {
    get id() {
      return server.key
    },
    get name() {
      return serverName(server.conn) || server.key
    },
    get url() {
      return server.ctx.sdk.url
    },
    get password() {
      return server.conn.http.password
    },
    get client() {
      return server.ctx.sdk.api
    },
    get data() {
      return server.ctx.data
    },
    get local() {
      return server.isLocal
    },
    get builtin() {
      return ServerConnection.builtin(server.conn)
    },
    get compatible() {
      return !server.health?.incompatible
    },
    get connected() {
      return server.ctx.sdk.connection.status() === "connected"
    },
  }

  const files: Files = {
    get root() {
      return location().directory
    },
    ready: file.ready,
    resolve: file.normalize,
    absolute: file.absolute,
    get: file.get,
    missing: file.notFound,
    sync: (path, options) => file.load(path, options),
    search: (query, options) =>
      options?.kind === "any" ? file.searchFilesAndDirectories(query) : file.searchFiles(query, options),
    selection: {
      get: (path) => file.selectedLines(path) as LineRange | null | undefined,
      set: (path, range) => void file.setSelectedLines(path, range),
    },
    scroll: {
      get: (path) => ({ top: file.scrollTop(path) as number | undefined, left: file.scrollLeft(path) as number | undefined }),
      set(path, value) {
        if (value.top !== undefined) file.setScrollTop(path, value.top)
        if (value.left !== undefined) file.setScrollLeft(path, value.left)
      },
    },
    tree: {
      list: file.tree.children,
      state: file.tree.state,
      sync: (path, options) => (options?.force ? file.tree.refresh(path) : file.tree.list(path)),
      expand: (path, options) => void file.tree.expand(path, options),
      collapse: (path) => void file.tree.collapse(path),
    },
  }

  const commentFile = (id: string) => comments.all().find((item) => item.id === id)?.file
  const comment: Comments = {
    list: (path) => (path ? comments.list(path) : comments.all()),
    add: comments.add,
    update(id, text) {
      const path = commentFile(id)
      if (path) comments.update(path, id, text)
    },
    remove(id) {
      const path = commentFile(id)
      if (path) comments.remove(path, id)
    },
    focus: { current: comments.focus, set: (value) => void comments.setFocus(value) },
    active: { current: comments.active, set: (value) => void comments.setActive(value) },
  }

  const contextPath = (id: string) =>
    composer.context.items().find((item) => item.type === "file" && item.commentID === id)?.path
  const composerRef: Composer = {
    attach: (part) => composer.context.add(part),
    update(id, patch) {
      const path = contextPath(id)
      if (path) composer.context.updateComment(path, id, patch)
    },
    detach(id) {
      const path = contextPath(id)
      if (path) composer.context.removeComment(path, id)
    },
  }

  const view: SessionView = {
    get key() {
      return `${server.key}\n${session.identity.sessionID() ?? ""}`
    },
    get id() {
      return session.identity.sessionID() ?? ""
    },
    get tab() {
      return session.layout.tabKey() ?? ""
    },
    server: serverRef,
    get pending() {
      return server.ctx.data.session.creating(session.identity.sessionID() ?? "")
    },
    get location() {
      return session.data.info()?.location
    },
    // The user's local name and icon override the server's, as in the sidebar.
    get project() {
      const base = session.project()
      const info = session.data.info()
      const details = base && info ? server.ctx.projects.detailsForSession(info) : undefined
      return base && details ? { ...base, name: details.name ?? base.name, icon: details.icon ?? base.icon } : base
    },
    get directory() {
      return session.workspace.directory()
    },
    get local() {
      return !session.workspace.current()
    },
    get background() {
      return background()?.() ?? noTasks
    },
    file: files,
    comment,
    composer: composerRef,
  }

  createEffect(() => {
    if (!session.identity.sessionID()) return
    onCleanup(attachment.mount(view.key, view))
  })

  return { view, bindBackground: (tasks: Accessor<readonly BackgroundTask[]>) => setBackground(() => tasks) }
}

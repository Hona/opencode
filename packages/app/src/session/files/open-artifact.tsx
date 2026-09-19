import { batch, createEffect, onCleanup, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { useBrowserAttachments } from "@/session/browser/attachments"
import type { SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { artifactKind, resolveArtifactPath } from "@/workspaces/files/artifact"
import { encodeFilePath } from "@/workspaces/files/path"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServer } from "@/runtime/server/current"
import { useSessionLayout } from "@/session/session-layout"
import type { createSessionBrowser } from "@/session/browser/model"

export function fileUrl(absolute: string) {
  return `file://${encodeFilePath(absolute)}`
}

/** Routes local links in timeline markdown to the artifact opener while keeping image loading. */
export function ArtifactMarkdownProvider(props: ParentProps) {
  const markdown = useMarkdown()
  const artifacts = useArtifactOpener()
  return (
    <MarkdownProvider readImage={markdown?.readImage} openLocalFile={(path) => artifacts.open(path)}>
      {props.children}
    </MarkdownProvider>
  )
}

/**
 * Opens files the agent references as side-panel tabs, inside or outside the workspace, or as
 * a browser tab for HTML when the desktop can load the file directly.
 */
export const { use: useArtifactOpener, provider: ArtifactOpenerProvider } = createSimpleContext({
  name: "ArtifactOpener",
  init: (props: { session: SessionModel; browser: ReturnType<typeof createSessionBrowser> }) => {
    const file = useFile()
    const server = useServer()
    const location = useWorkspaceLocation()
    const attachments = useBrowserAttachments()
    const { tabs, view } = useSessionLayout()

    const root = () => location().directory.replaceAll("\\", "/").replace(/\/+$/, "")

    /**
     * Turn a link into a path `useFile` can load: workspace-relative when it is under the root,
     * otherwise absolute. Relative links resolve against `base`; ones that climb past the root
     * become absolute too, so a `../../shared/report.pdf` still opens.
     */
    const resolve = (href: string, base?: string) => {
      const value = href.replaceAll("\\", "/")
      if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return file.normalize(value)
      const relative = resolveArtifactPath(base ?? "", value)
      if (relative !== undefined) return file.normalize(relative)
      return file.normalize(resolveArtifactPath(root(), value) ?? value)
    }

    const openTab = (path: string) => {
      const tab = file.tab(path)
      batch(() => {
        tabs().open(tab)
        void file.load(path)
        if (!view().reviewPanel.opened()) view().reviewPanel.open()
        tabs().setActive(tab)
      })
    }

    // Only a same-machine server can hand the browser pane a file:// URL it is able to read.
    const canOpenInBrowser = () => server.isLocal && props.browser.available() && props.browser.attached()

    const openInBrowser = (path: string) => {
      props.browser.command({ type: "tabs.open", url: fileUrl(file.absolute(path) ? path : `${root()}/${path}`) })
    }

    /** Open `href` as referenced from `base` (a workspace-relative directory, "" for the root). */
    const open = (href: string, base?: string) => {
      const path = resolve(href, base)
      if (artifactKind(path) === "html" && canOpenInBrowser()) return openInBrowser(path)
      openTab(path)
    }

    // The agent's browser.preview tool arrives through the desktop browser pane attachment.
    createEffect(() => {
      const sessionID = props.session.identity.sessionID()
      if (!sessionID) return
      onCleanup(attachments.onPreview(server, sessionID, (path) => open(path)))
    })

    return { canOpenInBrowser, openInBrowser, open }
  },
})

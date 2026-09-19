import { batch, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { showToast } from "@/shell/notifications/toast"
import { useFile } from "@/workspaces/files/model"
import { artifactKind, resolveArtifactPath } from "@/workspaces/files/artifact"
import { encodeFilePath } from "@/workspaces/files/path"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
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
 * Opens files the agent references: workspace files become side-panel tabs (or a browser tab
 * for HTML when the desktop can load it directly), files outside the workspace open in the OS.
 */
export const { use: useArtifactOpener, provider: ArtifactOpenerProvider } = createSimpleContext({
  name: "ArtifactOpener",
  init: (props: { browser: ReturnType<typeof createSessionBrowser> }) => {
    const file = useFile()
    const server = useServer()
    const platform = usePlatform()
    const language = useLanguage()
    const location = useWorkspaceLocation()
    const { tabs, view } = useSessionLayout()

    const root = () => location().directory.replaceAll("\\", "/").replace(/\/+$/, "")

    const resolve = (href: string, base?: string): { path: string } | { outside: string } => {
      const value = href.replaceAll("\\", "/")
      const dir = root()
      if (/^[a-z]:\//i.test(value) || value.startsWith("/")) {
        const windows = /^[a-z]:/i.test(dir)
        const prefix = `${dir}/`
        const inside = windows ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix)
        return inside ? { path: value.slice(prefix.length) } : { outside: value }
      }
      const path = resolveArtifactPath(base ?? "", value)
      return path === undefined ? { outside: `${dir}/${value}` } : { path }
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

    const openOutside = (absolute: string) => {
      if (server.isLocal && platform.openLocalFile) return platform.openLocalFile(fileUrl(absolute))
      showToast({
        variant: "error",
        title: language.t("toast.file.outsideWorkspace.title"),
        description: language.t("toast.file.outsideWorkspace.description", { path: absolute }),
      })
    }

    // Only a same-machine server can hand the browser pane a file:// URL it is able to read.
    const canOpenInBrowser = () => server.isLocal && props.browser.available() && props.browser.attached()

    const openInBrowser = (path: string) => {
      props.browser.command({ type: "tabs.open", url: fileUrl(`${root()}/${path}`) })
    }

    return {
      canOpenInBrowser,
      openInBrowser,
      /** Open `href` as referenced from `base` (a workspace-relative directory, "" for the root). */
      open(href: string, base?: string) {
        const target = resolve(href, base)
        if ("outside" in target) return openOutside(target.outside)
        if (artifactKind(target.path) === "html" && canOpenInBrowser()) return openInBrowser(target.path)
        openTab(target.path)
      },
    }
  },
})

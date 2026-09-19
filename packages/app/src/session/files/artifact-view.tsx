import { createMemo, onCleanup, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { getDirectory } from "@opencode/util/path"
import type { FileContent } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import { blobUrlFromContent, resolveArtifactPath } from "@/workspaces/files/artifact"
import { useArtifactOpener } from "@/session/files/open-artifact"

export type ArtifactMode = "preview" | "source"

export function ArtifactToolbar(props: {
  mode: ArtifactMode
  onModeChange: (mode: ArtifactMode) => void
  actions?: JSX.Element
}) {
  const language = useLanguage()
  return (
    <div class="flex items-center justify-between gap-2 px-4 pb-2">
      <SegmentedControl
        class="!w-auto"
        value={props.mode}
        onChange={(value) => {
          if (value === "preview" || value === "source") props.onModeChange(value)
        }}
      >
        <SegmentedControlItem value="preview">{language.t("file.view.preview")}</SegmentedControlItem>
        <SegmentedControlItem value="source">{language.t("file.view.source")}</SegmentedControlItem>
      </SegmentedControl>
      {props.actions}
    </div>
  )
}

export function OpenInBrowserButton(props: { path: string }) {
  const language = useLanguage()
  const artifacts = useArtifactOpener()
  return (
    <Show when={artifacts.canOpenInBrowser()}>
      <Button size="small" variant="ghost" icon="globe" onClick={() => artifacts.openInBrowser(props.path)}>
        {language.t("file.view.openInBrowser")}
      </Button>
    </Show>
  )
}

function createBlobUrl(content: () => FileContent) {
  const url = createMemo(() => {
    const value = blobUrlFromContent(content())
    onCleanup(() => URL.revokeObjectURL(value))
    return value
  })
  return url
}

export function ArtifactVideo(props: { content: FileContent; onLoad?: () => void }) {
  const url = createBlobUrl(() => props.content)
  return (
    <div class="flex justify-center bg-background-stronger px-6 py-4">
      <video
        class="max-h-[70vh] max-w-full rounded border border-border-weak-base bg-black"
        controls
        preload="metadata"
        src={url()}
        onLoadedMetadata={() => props.onLoad?.()}
      />
    </div>
  )
}

export function ArtifactFrame(props: { path: string; content: FileContent; kind: "pdf" | "html" }) {
  const url = createBlobUrl(() => props.content)
  return (
    <iframe
      class="block h-full w-full border-0 bg-white"
      title={props.path}
      src={url()}
      // The PDF viewer is Chromium's own and does not run in a sandboxed frame. HTML runs as an
      // opaque origin: no app storage, cookies, or credentialed requests reach it.
      sandbox={props.kind === "html" ? "allow-scripts allow-popups allow-forms allow-modals" : undefined}
      referrerPolicy="no-referrer"
    />
  )
}

export function ArtifactMarkdown(props: { path: string; text: string; cacheKey?: string }) {
  const parent = useMarkdown()
  const artifacts = useArtifactOpener()
  const dir = createMemo(() => getDirectory(props.path))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))
  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => artifacts.open(href, dir())}
    >
      <div class="px-6 py-4">
        <Markdown text={props.text} cacheKey={props.cacheKey} class="select-text" />
      </div>
    </MarkdownProvider>
  )
}

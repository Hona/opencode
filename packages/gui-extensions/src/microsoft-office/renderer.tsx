import { lazy, Suspense, type Component } from "solid-js"
import type { ArtifactKind } from "@opencode/util/artifact"
import { FileViewer, type FileViewerProps } from "../file/contract"
import { bindExtension, type Setup } from "../sdk"
import type MicrosoftOffice from "./index"

const setup: Setup<typeof MicrosoftOffice> = (ctx) => {
  // Each format loads its engine, several megabytes of wasm, only when a file of that format opens. Nothing preloads:
  // most sessions never open an Office file.
  const viewer = (kind: ArtifactKind, View: Component<FileViewerProps>) =>
    ctx.add(FileViewer, {
      kinds: [kind],
      View: bindExtension((props: FileViewerProps) => (
        <Suspense>
          <View {...props} />
        </Suspense>
      )),
    })

  viewer(
    "document",
    lazy(() => import("./document")),
  )
  viewer(
    "spreadsheet",
    lazy(() => import("./spreadsheet")),
  )
  viewer(
    "presentation",
    lazy(() => import("./presentation")),
  )
}

export default setup

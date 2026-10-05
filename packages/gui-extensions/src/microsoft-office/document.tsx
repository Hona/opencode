import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { Loader } from "@opencode/ui/loader"
import { buildResidentRegionLayoutRequest, computeLayout, getLayoutKernelInputs } from "@betteroffice/docx/editor"
import { createRustMeasureSource, type BundledFontProvider } from "@betteroffice/docx/layout"
import {
  buildRustDisplayList,
  createCanvasImageResolver,
  GlyphCache,
  presentDisplayPageBackBuffer,
  rasterizeDisplayPageToBackBuffer,
  type DisplayPage,
} from "@betteroffice/docx/layout/render"
import { createYrsSession, type YrsSession } from "@betteroffice/docx/yrs"
import { createKeyed, useExtension } from "../sdk"
import { faceUrl, fallbackFace, loadFace, officeFace } from "./fonts"
import { OfficePages, type PaintPage } from "./pages"
import type { FileViewerProps } from "../file/contract"

type Opened = { readonly pages: readonly DisplayPage[]; readonly paint: PaintPage }

/** The engine session one opening owns; freed when the bytes change or the view closes. */
type Owned = { session: YrsSession | undefined }

const FontRequirements = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      key: Schema.String,
      family: Schema.String,
      bold: Schema.Boolean,
      italic: Schema.Boolean,
      scripts: Schema.optional(Schema.Array(Schema.Literals(["cjk-sc", "cjk-tc", "cjk-jp", "cjk-kr", "arabic", "hebrew"]))),
    }),
  ),
)

const decodeFontRequirements = Schema.decodeUnknownSync(FontRequirements)

/**
 * A read-only, paginated Word document. It loads only the Yrs engine: the parse and layout engines, the background
 * worker and the collaboration code stay unloaded, and embedded fonts give way to the bundled metric-compatible faces.
 */
export default function OfficeDocument(props: FileViewerProps) {
  const ctx = useExtension()
  const [state, setState] = createStore<{ opened: Opened | undefined }>({ opened: undefined })

  // Syncs one engine session with the loaded bytes.
  createKeyed(
    () => props.bytes,
    (bytes) => {
      const controller = new AbortController()
      const owned: Owned = { session: undefined }

      onCleanup(() => {
        controller.abort()
        owned.session?.destroy()
        setState({ opened: undefined })
      })

      void open(bytes, controller.signal, owned).then(
        (opened) => {
          if (controller.signal.aborted) return

          setState({ opened })
          props.onDetails([ctx.plural("pages", opened.pages.length)])
        },
        () => {
          if (!controller.signal.aborted) props.onError()
        },
      )
    },
  )

  return (
    <Show
      when={state.opened}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <Loader />
        </div>
      }
    >
      {(opened) => (
        <OfficePages
          pages={opened().pages}
          maxScale={1}
          paint={opened().paint}
          label={(index) => ctx.t("page", { number: index + 1 })}
        />
      )}
    </Show>
  )
}

/** Lays the document out into pages. Every engine call after `signal` aborts is skipped: the session is freed then. */
async function open(bytes: Uint8Array, signal: AbortSignal, owned: Owned): Promise<Opened> {
  const session = await createYrsSession()

  // A view that closed while the engine loaded never saw this session.
  if (signal.aborted) {
    session.destroy()
    throw signal.reason
  }

  owned.session = session

  const document = session.openDocx(bytes, true, { mediaTokens: true }).document
  const settings = document.package.settings

  const measure = createRustMeasureSource({
    engine: {
      registerFont: (font) => (signal.aborted ? -1 : session.registerFont(font)),
      registerSubstituteFont: (id, family) => (signal.aborted ? id : session.registerSubstituteFont(id, family)),
      clearFonts: () => {
        if (!signal.aborted) session.clearFonts()
      },
    },
    bundled: wordFonts(signal),
  })

  measure.setCompat(settings?.compatibilityFlags)

  const renderEnv = {
    themeColors: Object.fromEntries(
      Object.entries(document.package.theme?.colorScheme ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    defaultTabStopTwips: settings?.defaultTabStop ?? null,
    numericIds: {},
    mediaTokens: true,
  }

  const requirements = decodeFontRequirements(
    session.layoutFontRequirementsJson(JSON.stringify(buildResidentRegionLayoutRequest(document, 0, renderEnv))),
  ).map((requirement) => ({ ...requirement, scripts: requirement.scripts && [...requirement.scripts] }))

  await measure.prepareFontRequirements(requirements)

  if (signal.aborted) throw signal.reason

  const measurement = measure.measurementConfigForRequirements(requirements)

  if (!measurement) throw new Error("The document's fonts could not be prepared")

  const layout = computeLayout({ document, pageGap: 0, session, renderEnv, measurement }).layout
  const kernel = getLayoutKernelInputs(layout)

  if (!kernel) throw new Error("The document produced no pages")

  // The session builds the display list, so the separate layout engine never loads.
  const list = await buildRustDisplayList(
    {
      measured: kernel.measured,
      options: kernel.options,
      layout,
      fontChains: measurement.fontChains,
      headersFooters: kernel.headersFooters,
    },
    { buildDisplayListJson: (input) => session.buildDisplayListJson(input) },
  )

  const glyphCache = new GlyphCache({
    provider: (font, glyph) => {
      if (signal.aborted) throw new Error("The document is closed")

      return session.outlineGlyphJson(font, glyph)
    },
  })

  const resolveImage = createCanvasImageResolver({
    media: (token) => (signal.aborted ? null : session.mediaSource(token)),
    mediaScope: () => (signal.aborted ? -1 : session.mediaScope()),
  })

  return {
    pages: list.pages,
    paint: async (index, canvas, scale, current) => {
      const page = list.pages[index]

      if (!page) return

      const buffer = await rasterizeDisplayPageToBackBuffer(
        globalThis.document.createElement("canvas"),
        page,
        { glyphCache, resolveImage },
        window.devicePixelRatio || 1,
        scale,
      )

      if (current() && !signal.aborted) presentDisplayPageBackBuffer(canvas, buffer, page, scale)
    },
  }
}

/** Word families resolve to the bundled faces with the same metrics; any other family to the closest kind. */
function wordFonts(signal: AbortSignal): BundledFontProvider {
  return {
    resolve: (family, bold, italic) => {
      const face = officeFace(family)

      return face ? () => loadFace(faceUrl(face, bold, italic), signal) : undefined
    },
    resolveLastResort: (family, bold, italic) => () => loadFace(faceUrl(fallbackFace(family), bold, italic), signal),
  }
}

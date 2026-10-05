import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Loader } from "@opencode/ui/loader"
import {
  decodePresentationImage,
  initWasm,
  openPresentation,
  paintSlide,
  sizeCanvasForSlide,
  type PptxFontFace,
} from "@betteroffice/pptx"
import { createKeyed, useExtension } from "../sdk"
import { faceUrl, fontStyles, loadFace, officeFaces } from "./fonts"
import { OfficePages, type PaintPage } from "./pages"
import type { FileViewerProps } from "../file/contract"

type Opened = { readonly slides: readonly { width: number; height: number }[]; readonly paint: PaintPage }

/** English Metric Units per CSS pixel. */
const emuPerPixel = 9525

/** A read-only PowerPoint deck: every slide fitted to the pane, painted as it scrolls into view. */
export default function OfficePresentation(props: FileViewerProps) {
  const ctx = useExtension()
  const [state, setState] = createStore<{ opened: Opened | undefined }>({ opened: undefined })

  // Syncs one engine deck, its browser faces and its decoded images with the loaded bytes.
  createKeyed(
    () => props.bytes,
    (bytes) => {
      const controller = new AbortController()
      const resources: Resources = { deck: undefined, faces: [], images: new Map() }

      onCleanup(() => {
        controller.abort()
        resources.deck?.dispose()
        resources.faces.forEach((face) => document.fonts.delete(face))
        resources.images.forEach((image) => void image.then((source) => close(source)))
        setState({ opened: undefined })
      })

      void open(bytes, controller.signal, resources).then(
        (opened) => {
          if (controller.signal.aborted) return

          setState({ opened })
          props.onDetails([ctx.plural("slides", opened.slides.length)])
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
          pages={opened().slides}
          maxScale={Number.POSITIVE_INFINITY}
          paint={opened().paint}
          label={(index) => ctx.t("slide", { number: index + 1 })}
        />
      )}
    </Show>
  )
}

type Resources = {
  deck: ReturnType<typeof openPresentation> | undefined
  faces: FontFace[]
  images: Map<string, Promise<CanvasImageSource | null>>
}

async function open(bytes: Uint8Array, signal: AbortSignal, resources: Resources): Promise<Opened> {
  const [loaded] = await Promise.all([presentationFonts(signal), initWasm()])

  if (signal.aborted) throw signal.reason

  // The engine shapes text with these bytes and the canvas draws it by family name, so the browser holds the same
  // faces under the same names.
  const faces = await Promise.all(
    loaded.map((font) =>
      new FontFace(font.family, font.buffer, {
        weight: font.bold ? "700" : "400",
        style: font.italic ? "italic" : "normal",
      }).load(),
    ),
  )

  if (signal.aborted) throw signal.reason

  faces.forEach((face) => document.fonts.add(face))
  resources.faces = faces

  const fonts: PptxFontFace[] = loaded.map((font) => ({
    family: font.family,
    bold: font.bold,
    italic: font.italic,
    bytes: new Uint8Array(font.buffer),
  }))

  const deck = openPresentation(bytes, { fonts })

  resources.deck = deck

  const snapshot = deck.snapshot()
  const size = { width: snapshot.widthEmu / emuPerPixel, height: snapshot.heightEmu / emuPerPixel }

  const resolveImage = (asset: string) => {
    const cached = resources.images.get(asset)

    if (cached) return cached

    const image = decodePresentationImage(deck.mediaBytes(asset), asset).catch(() => null)

    resources.images.set(asset, image)

    return image
  }

  return {
    slides: snapshot.slides.map(() => size),
    paint: async (index, canvas, scale, current) => {
      if (signal.aborted) return

      const frame = deck.layoutSlide(index)
      const buffer = document.createElement("canvas")
      const context = buffer.getContext("2d")
      const ratio = window.devicePixelRatio || 1

      if (!context) return

      sizeCanvasForSlide(buffer, frame, ratio, scale)
      await paintSlide(context, frame, ratio, scale, { resolveImage })

      if (!current() || signal.aborted) return

      canvas.width = buffer.width
      canvas.height = buffer.height
      canvas.getContext("2d")?.drawImage(buffer, 0, 0)
    },
  }
}

/** The bundled faces under the Office family names a deck asks for. */
function presentationFonts(signal: AbortSignal) {
  return Promise.all(
    officeFaces.flatMap((entry) =>
      fontStyles.map(async (style) => ({
        family: entry.family,
        bold: style.bold,
        italic: style.italic,
        buffer: await loadFace(faceUrl(entry.face, style.bold, style.italic), signal),
      })),
    ),
  )
}

function close(source: CanvasImageSource | null) {
  if (source instanceof ImageBitmap) source.close()
}

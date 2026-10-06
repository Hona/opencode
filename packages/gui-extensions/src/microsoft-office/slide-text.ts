import { Option, Schema } from "effect"
import { inspectPresentation, type DeckSnapshot } from "@betteroffice/pptx"

/** A text style a deck draws with. */
export type FontStyle = { readonly bold: boolean; readonly italic: boolean }

/** A family the deck names, with the styles its text asks for. */
export type DeckFamily = { readonly name: string; readonly styles: readonly FontStyle[] }

/** The scripts the bundled Latin faces may lack, which have a bundled fallback face. */
export type FallbackScript = "hebrew" | "arabic"

/** What a deck's text needs from the fonts, and which slides it hides. */
export type DeckText = {
  /** Most important first: the face registered first also draws every family the deck names but nobody found. */
  readonly families: readonly DeckFamily[]
  readonly scripts: readonly FallbackScript[]
  /** One flag per slide, in deck order. */
  readonly hidden: readonly boolean[]
}

const RunStyle = Schema.Struct({
  bold: Schema.optional(Schema.NullOr(Schema.Boolean)),
  italic: Schema.optional(Schema.NullOr(Schema.Boolean)),
  fontFamily: Schema.optional(Schema.NullOr(Schema.String)),
})

const Body = Schema.Struct({
  paragraphs: Schema.Array(
    Schema.Struct({
      runs: Schema.Array(Schema.Struct({ text: Schema.String, properties: Schema.optional(Schema.NullOr(RunStyle)) })),
    }),
  ),
})

type Drawing = {
  readonly text?: typeof Body.Type | null | undefined
  readonly children?: readonly Drawing[] | undefined
  readonly data?: typeof Table.Type | null | undefined
}

const Table = Schema.Struct({
  rows: Schema.optional(
    Schema.Array(Schema.Struct({ cells: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.NullOr(Body)) })) })),
  ),
})

/** A slide object: a shape, group, picture or graphic frame. */
const Drawing: Schema.Codec<Drawing> = Schema.Struct({
  text: Schema.optional(Schema.NullOr(Body)),
  children: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<Drawing> => Drawing))),
  // A table's cells; other frames, such as charts, carry no rows.
  data: Schema.optional(Schema.NullOr(Table)),
})

const ThemeFont = Schema.Struct({ latin: Schema.String })

const Inspected = Schema.Struct({
  slides: Schema.Array(
    Schema.Struct({ hidden: Schema.optional(Schema.Boolean), drawings: Schema.Array(Drawing) }).pipe(
      Schema.encodeKeys({ drawings: "shapes" }),
    ),
  ),
  layouts: Schema.optional(
    Schema.Array(Schema.Struct({ drawings: Schema.Array(Drawing) }).pipe(Schema.encodeKeys({ drawings: "shapes" }))),
  ),
  masters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        drawings: Schema.Array(Drawing),
        textStyles: Schema.optional(
          Schema.NullOr(
            Schema.Record(
              Schema.String,
              Schema.Array(Schema.Struct({ defaultRun: Schema.optional(Schema.NullOr(RunStyle)) })),
            ),
          ),
        ),
      }).pipe(Schema.encodeKeys({ drawings: "shapes" })),
    ),
  ),
  themes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        theme: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              fontScheme: Schema.optional(Schema.NullOr(Schema.Struct({ majorFont: ThemeFont, minorFont: ThemeFont }))),
            }),
          ),
        ),
      }),
    ),
  ),
})

const decodeInspected = Schema.decodeUnknownOption(Inspected)

const scriptRanges: readonly (readonly [FallbackScript, RegExp])[] = [
  ["hebrew", /[\u0590-\u05FF\uFB1D-\uFB4F]/u],
  ["arabic", /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u],
]

/**
 * Reads the families, styles and scripts a deck's text uses, from its slides, layouts, masters and theme. When the
 * engine's inspection does not decode, the slides' own runs stand in, without theme fonts or hidden flags.
 */
export function deckText(bytes: Uint8Array, snapshot: DeckSnapshot): DeckText {
  return Option.match(decodeInspected(inspectPresentation(bytes)), {
    onNone: () => fromSnapshot(snapshot),
    onSome: (inspected) => {
      const scheme = inspected.themes?.flatMap((theme) => (theme.theme?.fontScheme ? [theme.theme.fontScheme] : []))[0]
      const major = scheme?.majorFont.latin ?? ""
      const minor = scheme?.minorFont.latin ?? ""

      const drawings = [
        ...inspected.slides.flatMap((slide) => slide.drawings),
        ...(inspected.layouts ?? []).flatMap((layout) => layout.drawings),
        ...(inspected.masters ?? []).flatMap((master) => master.drawings),
      ]

      const defaults = (inspected.masters ?? []).flatMap((master) =>
        Object.values(master.textStyles ?? {}).flatMap((levels) =>
          levels.flatMap((level) => (level.defaultRun ? [{ text: "", style: level.defaultRun }] : [])),
        ),
      )

      return summarize(
        [...drawings.flatMap(drawingRuns), ...defaults],
        (family) => {
          if (!family || family.startsWith("+mn")) return minor

          if (family.startsWith("+mj")) return major

          if (family.startsWith("+")) return ""

          return family
        },
        minor,
        inspected.slides.map((slide) => slide.hidden ?? false),
      )
    },
  })
}

type Run = { readonly text: string; readonly style: typeof RunStyle.Type | null | undefined }

function drawingRuns(drawing: Drawing): Run[] {
  return [
    ...bodyRuns(drawing.text),
    ...(drawing.data?.rows ?? []).flatMap((row) => row.cells.flatMap((cell) => bodyRuns(cell.text))),
    ...(drawing.children ?? []).flatMap(drawingRuns),
  ]
}

function bodyRuns(body: typeof Body.Type | null | undefined): Run[] {
  return (body?.paragraphs ?? []).flatMap((paragraph) =>
    paragraph.runs.map((run) => ({ text: run.text, style: run.properties })),
  )
}

function fromSnapshot(snapshot: DeckSnapshot): DeckText {
  const runs = (drawings: DeckSnapshot["slides"][number]["shapes"]): Run[] =>
    drawings.flatMap((drawing) => [
      ...drawing.textStories.flatMap((story) =>
        story.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => ({ text: run.text, style: run.style }))),
      ),
      ...runs(drawing.children),
    ])

  return summarize(
    snapshot.slides.flatMap((slide) => runs(slide.shapes)),
    (family) => family ?? "",
    "",
    snapshot.slides.map(() => false),
  )
}

/**
 * Groups runs by the family they resolve to: the theme's body font first, then by how much text each draws. The
 * masters' default runs count too, so a theme font that placeholders inherit without naming it is still found.
 */
function summarize(
  runs: readonly Run[],
  resolve: (family: string | null | undefined) => string,
  theme: string,
  hidden: readonly boolean[],
): DeckText {
  const families = new Map<string, { name: string; weight: number; styles: Map<string, FontStyle> }>()
  const body = theme.trim().toLowerCase()
  const text = runs.map((run) => run.text).join("")

  runs.forEach((run) => {
    const name = resolve(run.style?.fontFamily).trim()

    if (!name) return

    const style = { bold: run.style?.bold ?? false, italic: run.style?.italic ?? false }
    const family = families.get(name.toLowerCase()) ?? { name, weight: 0, styles: new Map<string, FontStyle>() }

    family.weight += run.text.length
    family.styles.set(`${style.bold}|${style.italic}`, style)
    families.set(name.toLowerCase(), family)
  })

  return {
    families: [...families.entries()]
      .toSorted((left, right) => rank(right, body) - rank(left, body))
      .map((entry) => ({
        name: entry[1].name,
        // Regular first, so a family's first face is the one its unstyled text draws with.
        styles: [...entry[1].styles.values()].toSorted((left, right) => styleRank(left) - styleRank(right)),
      })),
    scripts: scriptRanges.flatMap((entry) => (entry[1].test(text) ? [entry[0]] : [])),
    hidden,
  }
}

function rank(entry: readonly [string, { readonly weight: number }], body: string) {
  return entry[0] === body ? Number.POSITIVE_INFINITY : entry[1].weight
}

function styleRank(style: FontStyle) {
  return (style.bold ? 1 : 0) + (style.italic ? 2 : 0)
}

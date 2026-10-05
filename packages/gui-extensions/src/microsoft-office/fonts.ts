import caladeaBold from "@betteroffice/fonts/assets/Caladea-Bold.ttf?url"
import caladeaBoldItalic from "@betteroffice/fonts/assets/Caladea-BoldItalic.ttf?url"
import caladeaItalic from "@betteroffice/fonts/assets/Caladea-Italic.ttf?url"
import caladeaRegular from "@betteroffice/fonts/assets/Caladea-Regular.ttf?url"
import carlitoBold from "@betteroffice/fonts/assets/Carlito-Bold.ttf?url"
import carlitoBoldItalic from "@betteroffice/fonts/assets/Carlito-BoldItalic.ttf?url"
import carlitoItalic from "@betteroffice/fonts/assets/Carlito-Italic.ttf?url"
import carlitoRegular from "@betteroffice/fonts/assets/Carlito-Regular.ttf?url"
import monoBold from "@betteroffice/fonts/assets/LiberationMono-Bold.ttf?url"
import monoBoldItalic from "@betteroffice/fonts/assets/LiberationMono-BoldItalic.ttf?url"
import monoItalic from "@betteroffice/fonts/assets/LiberationMono-Italic.ttf?url"
import monoRegular from "@betteroffice/fonts/assets/LiberationMono-Regular.ttf?url"
import sansBold from "@betteroffice/fonts/assets/LiberationSans-Bold.ttf?url"
import sansBoldItalic from "@betteroffice/fonts/assets/LiberationSans-BoldItalic.ttf?url"
import sansItalic from "@betteroffice/fonts/assets/LiberationSans-Italic.ttf?url"
import sansRegular from "@betteroffice/fonts/assets/LiberationSans-Regular.ttf?url"
import serifBold from "@betteroffice/fonts/assets/LiberationSerif-Bold.ttf?url"
import serifBoldItalic from "@betteroffice/fonts/assets/LiberationSerif-BoldItalic.ttf?url"
import serifItalic from "@betteroffice/fonts/assets/LiberationSerif-Italic.ttf?url"
import serifRegular from "@betteroffice/fonts/assets/LiberationSerif-Regular.ttf?url"

type Face = { readonly regular: string; readonly bold: string; readonly italic: string; readonly boldItalic: string }

/**
 * The open faces that share their metrics with the common Office fonts, so text wraps and paginates as it does in
 * Office. Arial comes first: it is the face a presentation draws a family with no face of its own in.
 */
export const officeFaces = [
  {
    family: "Arial",
    aliases: ["arial", "helvetica", "helvetica neue", "arimo", "liberation sans"],
    face: { regular: sansRegular, bold: sansBold, italic: sansItalic, boldItalic: sansBoldItalic },
  },
  {
    family: "Calibri",
    aliases: ["calibri", "carlito"],
    face: { regular: carlitoRegular, bold: carlitoBold, italic: carlitoItalic, boldItalic: carlitoBoldItalic },
  },
  {
    family: "Cambria",
    aliases: ["cambria", "caladea"],
    face: { regular: caladeaRegular, bold: caladeaBold, italic: caladeaItalic, boldItalic: caladeaBoldItalic },
  },
  {
    family: "Times New Roman",
    aliases: ["times new roman", "times", "tinos", "liberation serif"],
    face: { regular: serifRegular, bold: serifBold, italic: serifItalic, boldItalic: serifBoldItalic },
  },
  {
    family: "Courier New",
    aliases: ["courier new", "courier", "cousine", "liberation mono"],
    face: { regular: monoRegular, bold: monoBold, italic: monoItalic, boldItalic: monoBoldItalic },
  },
] as const

export const fontStyles = [
  { bold: false, italic: false },
  { bold: true, italic: false },
  { bold: false, italic: true },
  { bold: true, italic: true },
] as const

/** The face file for one style. */
export function faceUrl(face: Face, bold: boolean, italic: boolean) {
  if (bold && italic) return face.boldItalic

  if (bold) return face.bold

  if (italic) return face.italic

  return face.regular
}

/** The metric-compatible face for an Office family, or undefined when none is bundled. */
export function officeFace(family: string) {
  const name = family.trim().toLowerCase()

  return officeFaces.find((entry) => entry.aliases.some((alias) => alias === name))?.face
}

/** The bundled face closest in kind to a family that has no metric-compatible face: mono, serif, or sans. */
export function fallbackFace(family: string) {
  const name = family.toLowerCase()

  if (/mono|consolas|courier|typewriter|menlo|cascadia/.test(name)) return officeFaces[4].face

  if (!name.includes("sans") && /serif|times|georgia|garamond|palatino|baskerville|bodoni|book/.test(name))
    return officeFaces[3].face

  return officeFaces[0].face
}

/** Reads a bundled face. The files ship with the app, so this never leaves the machine. */
export async function loadFace(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })

  if (!response.ok) throw new Error(`Font ${url} answered ${response.status}`)

  return response.arrayBuffer()
}

import type { BundledFontProvider } from "@betteroffice/docx/layout"
import {
  createFontProvider,
  loadBundledFontBytes,
  resolveBundledFamilyFace,
  resolveLastResortFace,
  resolveMetricCompatFace,
  resolveScriptFallbackFace,
  type BundledFontFace,
  type BundledFontScript,
} from "@betteroffice/fonts"

// Every face loads from the app's own files, so no font request leaves the machine. The Chinese, Japanese and Korean
// faces are an add-on the app does not ship (see `fonts-cjk.ts`).
function shipped(script: BundledFontScript) {
  return !script.startsWith("cjk-")
}

/** The faces Word substitutes for a document's fonts: metric-compatible ones first, then Word's own fallbacks. */
export function wordFonts(): BundledFontProvider {
  const source = createFontProvider()

  return {
    resolve: (family, bold, italic) => source.resolve(family, bold, italic),
    resolveFamily: (family, bold, italic) => source.resolveFamily(family, bold, italic),
    resolveScriptFallback: (script, bold, italic) =>
      shipped(script) ? source.resolveScriptFallback(script, bold, italic) : undefined,
    resolveLastResort: (family, bold, italic) => source.resolveLastResort(family, bold, italic, "word"),
  }
}

/** The face PowerPoint draws a family with: its metric-compatible or bundled face, else PowerPoint's substitute. */
export function presentationFace(family: string, bold: boolean, italic: boolean): BundledFontFace {
  return (
    resolveMetricCompatFace(family, bold, italic) ??
    resolveBundledFamilyFace(family, bold, italic) ??
    resolveLastResortFace(family, bold, italic, "powerpoint")
  )
}

/** The face that covers a script the Latin faces lack, or undefined when the app ships none. */
export function scriptFace(script: BundledFontScript, bold: boolean, italic: boolean) {
  return shipped(script) ? resolveScriptFallbackFace(script, bold, italic) : undefined
}

/**
 * A bundled face's bytes. The font package caches them per worker, so a face loads once per open file; the browser's
 * caches, which every worker shares, serve the files to the next.
 */
export function loadFace(face: BundledFontFace) {
  return loadBundledFontBytes(face)
}

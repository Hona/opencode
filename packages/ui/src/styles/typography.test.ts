import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  ScriptKind,
  ScriptTarget,
  createSourceFile,
  forEachChild,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  type Node,
} from "typescript"

const packages = resolve(import.meta.dir, "../../..")
const roots = ["ui/src", "session-ui/src", "app/src"]
const cssBlock = /([^{}]+)\{([^{}]*)\}/gs

test("V2 text uses safe line-height tokens", async () => {
  const violations: string[] = []

  for (const root of roots) {
    for await (const file of new Bun.Glob("**/*.{css,tsx}").scan({ cwd: resolve(packages, root), absolute: true })) {
      const source = await Bun.file(file).text()
      const relative = file.slice(packages.length + 1)

      if (file.endsWith(".tsx") && /text-\[13px\]/.test(source) && /leading-(?:none|\[13px\])/.test(source)) {
        const parsed = createSourceFile(file, source, ScriptTarget.Latest, true, ScriptKind.TSX)
        const visit = (node: Node) => {
          if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
            const attributes = node.attributes.getText(parsed)
            if (/text-\[13px\]/.test(attributes) && /leading-(?:none|\[13px\])/.test(attributes))
              violations.push(relative)
          }
          forEachChild(node, visit)
        }
        visit(parsed)
      }
      if (!file.endsWith(".css")) continue
      if (!/font-size:\s*13px;/.test(source)) continue
      if (!/line-height:\s*(?:1|100%|13px);/.test(source)) continue

      for (const match of source.matchAll(cssBlock)) {
        if (!/font-size:\s*13px;/.test(match[2])) continue
        if (!/line-height:\s*(?:1|100%|13px);/.test(match[2])) continue
        violations.push(`${relative}:${source.slice(0, match.index).split("\n").length}`)
      }
    }
  }

  expect(violations).toEqual([])
  const theme = await Bun.file(resolve(packages, "ui/src/styles/tokens/theme.css")).text()
  const tailwind = await Bun.file(resolve(packages, "ui/src/styles/tailwind/index.css")).text()
  for (const [name, value] of [
    ["tight", "12px"],
    ["compact", "16px"],
    ["base", "20px"],
  ]) {
    expect(theme).toContain(`--v2-line-height-${name}: ${value}`)
    expect(tailwind).toContain(`--leading-v2-${name}: var(--v2-line-height-${name})`)
  }
})

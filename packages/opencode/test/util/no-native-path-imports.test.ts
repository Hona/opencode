import { describe, expect, test } from "bun:test"
import nodePath from "node:path"

describe("path imports", () => {
  test("opencode/src uses posix path shim", async () => {
    const root = nodePath.join(import.meta.dir, "..", "..", "src")
    const glob = new Bun.Glob("**/*.{ts,tsx}")
    const hits: string[] = []

    for await (const file of glob.scan({ cwd: root, absolute: true })) {
      const normalized = file.replace(/\\/g, "/")
      if (normalized.endsWith("/src/util/path.ts")) continue

      const content = await Bun.file(file)
        .text()
        .catch(() => "")
      if (!content) continue

      const direct = /^\s*import\s+.*\s+from\s+["'](?:node:)?path["']\s*$/m.test(content)
      const named = /^\s*import\s+\{[^}]*\}\s+from\s+["'](?:node:)?path["']\s*$/m.test(content)
      if (direct || named) hits.push(normalized)
    }

    expect(hits).toEqual([])
  })
})

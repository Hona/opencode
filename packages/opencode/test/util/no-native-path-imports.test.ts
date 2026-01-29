import { describe, expect, test } from "bun:test"
import nodePath from "node:path"

describe("path imports", () => {
  test("repo source avoids native path imports", async () => {
    const roots = [
      { name: "opencode", dir: nodePath.join(import.meta.dir, "..", "..", "src"), allow: ["/src/util/path.ts"] },
      { name: "app", dir: nodePath.join(import.meta.dir, "..", "..", "..", "app", "src"), allow: [] },
      { name: "desktop", dir: nodePath.join(import.meta.dir, "..", "..", "..", "desktop", "src"), allow: [] },
    ]
    const glob = new Bun.Glob("**/*.{ts,tsx}")
    const hits: string[] = []

    for (const root of roots) {
      const allow = new Set(root.allow)
      for await (const file of glob.scan({ cwd: root.dir, absolute: true })) {
        const normalized = file.replace(/\\/g, "/")
        if (allow.size && Array.from(allow).some((x) => normalized.endsWith(x))) continue

        const content = await Bun.file(file)
          .text()
          .catch(() => "")
        if (!content) continue

        const direct = /^\s*import\s+.*\s+from\s+["'](?:node:)?path["']\s*$/m.test(content)
        const named = /^\s*import\s+\{[^}]*\}\s+from\s+["'](?:node:)?path["']\s*$/m.test(content)
        if (direct || named) hits.push(`${root.name}:${normalized}`)
      }
    }

    expect(hits).toEqual([])
  })
})

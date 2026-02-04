import { describe, expect, test } from "bun:test"
import nodePath from "node:path"

describe("path imports", () => {
  // Canonical rule: paths are POSIX/Bash-compatible everywhere.
  // Why: Windows backslashes caused
  // - UI file search/filter mismatches (client query used "\" while indexed paths used "/")
  // - server/client path comparisons to fail (drive/UNC edge cases)
  // - bash tool arg parsing to mis-handle paths ("\" is an escape in bash)
  // Enforcement via import boundaries:
  // - opencode/src must use @/util/path (Node wrapper + /tmp mapping)
  // - app/ui/web/sdk/desktop/plugin must use @opencode-ai/util/path (browser-safe)
  // - native path/node:path imports are disallowed everywhere
  test("repo source avoids native path imports", async () => {
    const base = nodePath.join(import.meta.dir, "..", "..", "..")
    const roots = [
      { name: "opencode", dir: nodePath.join(import.meta.dir, "..", "..", "src"), allow: ["/src/util/path.ts"] },
      { name: "app", dir: nodePath.join(base, "app", "src"), allow: [] },
      { name: "desktop", dir: nodePath.join(base, "desktop", "src"), allow: [] },
      { name: "plugin", dir: nodePath.join(base, "plugin", "src"), allow: [] },
      { name: "sdk", dir: nodePath.join(base, "sdk", "js", "src"), allow: [] },
      { name: "ui", dir: nodePath.join(base, "ui", "src"), allow: [] },
      { name: "web", dir: nodePath.join(base, "web", "src"), allow: [] },
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
        if (direct || named) hits.push(`${root.name}:${normalized}:path`)

        const serverPath = /^\s*import\s+.*\s+from\s+["']@\/util\/path["']\s*$/m.test(content)
        const clientPath = /^\s*import\s+.*\s+from\s+["']@opencode-ai\/util\/path["']\s*$/m.test(content)

        if (root.name === "opencode" && clientPath) hits.push(`${root.name}:${normalized}:@opencode-ai/util/path`)
        if (root.name !== "opencode" && serverPath) hits.push(`${root.name}:${normalized}:@/util/path`)
      }
    }

    expect(hits).toEqual([])
  })
})

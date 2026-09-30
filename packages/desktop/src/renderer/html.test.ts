import { expect, test } from "bun:test"
import { join } from "node:path"

// Packaged windows load the renderer through the privileged `oc://` protocol, where a root-relative
// path such as `src="/foo.js"` resolves from the protocol origin instead of next to the HTML entry.
test("index.html references local resources by relative path", async () => {
  const content = await Bun.file(join(import.meta.dirname, "index.html")).text()
  const paths = [...content.matchAll(/\bsrc=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["']/g)].map(
    (match) => match[1] ?? match[2],
  )
  expect(paths.length).toBeGreaterThan(0)
  for (const path of paths) expect(path).not.toMatch(/^\/[^/]/)
})

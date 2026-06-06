import { expect, test } from "bun:test"

test("mounts the WSL server consumer lazily below app providers", async () => {
  const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

  expect(source).toContain("<Show when={true}>{(_) => <App />}</Show>")
})

test("reactively leaves the splash after desktop resources load", async () => {
  const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

  expect(source).toContain('<Show when={ready()} fallback={splash}>')
  expect(source).not.toContain("if (!ready()) return splash")
})

import { expect, test } from "bun:test"
import { createComponent, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { DialogProvider, useDialog } from "./dialog"

test("disposing DialogProvider disposes active detached dialog roots", async () => {
  const container = document.createElement("div")
  let dialog: ReturnType<typeof useDialog> | undefined
  let cleaned = 0

  function Harness() {
    dialog = useDialog()
    return null
  }

  function Content() {
    onCleanup(() => cleaned++)
    const node = document.createElement("div")
    node.textContent = "Dialog content"
    return node
  }

  const dispose = render(
    () =>
      createComponent(DialogProvider, {
        get children() {
          return createComponent(Harness, {})
        },
      }),
    container,
  )

  expect(dialog).toBeDefined()
  await dialog?.show(() => createComponent(Content, {}))
  expect(cleaned).toBe(0)
  dispose()
  expect(cleaned).toBe(1)
})

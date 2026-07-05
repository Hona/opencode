import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useFilteredList } from "./use-filtered-list"

test("preserves a valid current item when asynchronous items resolve", async () => {
  const pending = Promise.withResolvers<{ id: string }[]>()
  const current = { id: "second" }
  let list: ReturnType<typeof useFilteredList<{ id: string }>> | undefined

  const dispose = createRoot((dispose) => {
    list = useFilteredList({
      items: () => pending.promise,
      key: (item) => item.id,
      current,
    })
    return dispose
  })

  pending.resolve([{ id: "first" }, current])
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(list?.active()).toBe("second")
  dispose()
})

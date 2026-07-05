import { expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { List, type ListProps, type ListRef } from "./list"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const loaded = async (container: HTMLElement) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (container.querySelector('[data-slot="list-item"]')) return
    await tick()
  }
}
const itemCount = async (container: HTMLElement, count: number) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (container.querySelectorAll('[data-slot="list-item"]').length === count) return
    await tick()
  }
}
const items = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
]
type ItemListProps = ListProps<(typeof items)[number]> & { ref?: (ref: ListRef) => void }

test("clear updates the displayed and applied controlled filter through the same path", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const changes: string[] = []
  const [filter, setFilter] = createSignal("alpha")
  const dispose = render(
    () =>
      createComponent<ItemListProps>(List, {
        items,
        key: (item) => item.id,
        filterKeys: ["label"],
        get filter() {
          return filter()
        },
        onFilter: (value) => {
          changes.push(value)
          setFilter(value)
        },
        search: true,
        children: (item) => item.label,
      }),
    container,
  )

  await loaded(container)
  expect(container.querySelectorAll('[data-slot="list-item"]')).toHaveLength(1)

  const clear = container.querySelector<HTMLButtonElement>('[aria-label="Clear filter"]')
  expect(clear).not.toBeNull()
  clear?.click()
  await itemCount(container, 2)

  expect(changes).toEqual([""])
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("")
  expect(container.querySelectorAll('[data-slot="list-item"]')).toHaveLength(2)
  dispose()
  container.remove()
})

test("notifies onMove for active transitions but not unchanged refetches", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const moved: (string | undefined)[] = []
  let ref: ListRef | undefined
  const dispose = render(
    () =>
      createComponent<ItemListProps>(List, {
        ref: (value) => (ref = value),
        items,
        key: (item) => item.id,
        onMove: (item) => moved.push(item?.id),
        children: (item) => item.label,
      }),
    container,
  )

  await tick()
  moved.length = 0
  ref?.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }))
  expect(moved).toEqual(["beta"])

  moved.length = 0
  ref?.setFilter("")
  await tick()
  expect(moved).toEqual([])
  dispose()
  container.remove()
})

import fuzzysort from "fuzzysort"
import { entries, flatMap, groupBy, map, pipe } from "remeda"
import { createEffect, createMemo, createResource, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createList } from "solid-list"

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filter?: string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: { category: string; items: T[] }, b: { category: string; items: T[] }) => number
  skipFilter?: (item: T) => boolean
  onSelect?: (value: T | undefined, index: number) => void
  onMove?: (value: T | undefined) => void
  noInitialSelection?: boolean
}

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const [store, setStore] = createStore<{ filter: string }>({ filter: "" })
  const filter = () => props.filter ?? store.filter

  type Group = { category: string; items: [T, ...T[]] }
  const empty: Group[] = []

  const [grouped, { refetch }] = createResource(
    () => ({
      filter: filter(),
      items: typeof props.items === "function" ? props.items(filter()) : props.items,
    }),
    async ({ filter, items }) => {
      const query = filter ?? ""
      const needle = query.toLowerCase()
      const all = (await Promise.resolve(items)) || []
      const result = pipe(
        all,
        (x) => {
          if (!needle) return x
          const skipFilter = props.skipFilter
          const filterable = skipFilter ? x.filter((item) => !skipFilter(item)) : x
          const skipped = skipFilter ? x.filter(skipFilter) : []
          const filtered =
            !props.filterKeys && Array.isArray(filterable) && filterable.every((e) => typeof e === "string")
              ? (fuzzysort.go(needle, filterable).map((x) => x.target) as T[])
              : fuzzysort.go(needle, filterable, { keys: props.filterKeys! }).map((x) => x.obj)
          return skipped.length ? [...filtered, ...skipped] : filtered
        },
        groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
        entries(),
        map(([k, v]) => ({ category: k, items: props.sortBy ? v.sort(props.sortBy) : v })),
        (groups) => (props.sortGroupsBy ? groups.sort(props.sortGroupsBy) : groups),
      )
      return result
    },
    { initialValue: empty },
  )

  const flat = createMemo(() => {
    return pipe(
      grouped.latest || [],
      flatMap((x) => x.items),
    )
  })

  function reconcileActive() {
    if (props.noInitialSelection) return ""
    const items = flat()
    const current = props.current ? props.key(props.current) : undefined
    if (current && items.some((item) => props.key(item) === current)) return current
    const active = list.active()
    if (active && items.some((item) => props.key(item) === active)) return active
    return items[0] ? props.key(items[0]) : ""
  }

  const list = createList({
    items: () => flat().map(props.key),
    initialActive: props.noInitialSelection ? "" : props.current ? props.key(props.current) : "",
    loop: true,
  })

  let moved: string | null = null
  const notifyMove = () => {
    const active = list.active()
    if (active === moved) return
    moved = active
    props.onMove?.(flat().find((item) => props.key(item) === active))
  }
  const setActive = (key: string | null) => {
    list.setActive(key)
    notifyMove()
  }
  const reset = () => {
    setActive(reconcileActive())
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault()
      const selectedIndex = flat().findIndex((x) => props.key(x) === list.active())
      const selected = flat()[selectedIndex]
      if (selected) props.onSelect?.(selected, selectedIndex)
    } else if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === "n" || event.key === "p") {
        event.preventDefault()
        const navEvent = new KeyboardEvent("keydown", {
          key: event.key === "n" ? "ArrowDown" : "ArrowUp",
          bubbles: true,
        })
        list.onKeyDown(navEvent)
        notifyMove()
      }
    } else {
      // Skip list navigation for text editing shortcuts (e.g., Option+Arrow, Option+Backspace on macOS)
      if (event.altKey || event.metaKey) return
      list.onKeyDown(event)
      notifyMove()
    }
  }

  createEffect(
    on(grouped, () => {
      reset()
    }),
  )

  const onInput = (value: string) => {
    setStore("filter", value)
  }

  return {
    grouped,
    filter,
    flat,
    reset,
    refetch,
    clear: () => setStore("filter", ""),
    onKeyDown,
    onInput,
    active: list.active,
    setActive,
  }
}

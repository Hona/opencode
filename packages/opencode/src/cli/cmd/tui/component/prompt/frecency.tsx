import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import { useSync } from "../../context/sync"
import { serverPathKey } from "../../util/path"

type Entry = {
  key?: string
  path: string
  frequency: number
  lastOpen: number
}

function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  const daysSince = (Date.now() - entry.lastOpen) / 86400000 // ms per day
  const weight = 1 / (1 + daysSince)
  return entry.frequency * weight
}

const MAX_FRECENCY_ENTRIES = 1000

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const sync = useSync()
    const frecencyPath = path.join(Global.Path.state, "frecency.jsonl")
    onMount(async () => {
      const text = await Filesystem.readText(frecencyPath).catch(() => "")
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Entry
          } catch {
            return null
          }
        })
        .filter((line): line is Entry => line !== null)

      const latest = lines.reduce(
        (acc, entry) => {
          acc[entry.key ?? entry.path] = entry
          return acc
        },
        {} as Record<string, Entry>,
      )

      const sorted = Object.values(latest)
        .sort((a, b) => b.lastOpen - a.lastOpen)
        .slice(0, MAX_FRECENCY_ENTRIES)

      setStore(
        "data",
        Object.fromEntries(
          sorted.map((entry) => [entry.key ?? entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
        ),
      )

      if (sorted.length > 0) {
        const content = sorted.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
        writeFile(frecencyPath, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      data: {} as Record<string, { frequency: number; lastOpen: number }>,
    })

    function updateFrecency(filePath: string) {
      const key = serverPathKey(filePath, sync.data.path)
      const newEntry = {
        frequency: (store.data[key]?.frequency || 0) + 1,
        lastOpen: Date.now(),
      }
      setStore("data", key, newEntry)
      appendFile(frecencyPath, JSON.stringify({ key, path: filePath, ...newEntry }) + "\n").catch(() => {})

      if (Object.keys(store.data).length > MAX_FRECENCY_ENTRIES) {
        const sorted = Object.entries(store.data)
          .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
          .slice(0, MAX_FRECENCY_ENTRIES)
        setStore("data", Object.fromEntries(sorted))
        const content = sorted.map(([key, entry]) => JSON.stringify({ key, path: key, ...entry })).join("\n") + "\n"
        writeFile(frecencyPath, content).catch(() => {})
      }
    }

    return {
      getFrecency: (filePath: string) => calculateFrecency(store.data[serverPathKey(filePath, sync.data.path)]),
      updateFrecency,
      data: () => store.data,
    }
  },
})

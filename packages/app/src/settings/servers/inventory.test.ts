import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import type { PluginServer } from "@/runtime/plugin/servers"
import { settingsProjects, settingsServers } from "./inventory"

const ssh: PluginServer = {
  key: "ssh:build",
  plugin: "ssh",
  entry: { id: "build", name: "Build server", state: "stopped" },
}

const connection: ServerConnection.Plugin = {
  type: "plugin",
  key: "ssh:build",
  plugin: "ssh",
  state: "stopped",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  displayName: "Build server",
  http: { url: "http://127.0.0.1:4000", password: "secret" },
}

test("settings project inventory reads metadata without acquiring directory stores", () => {
  const projects = Array.from({ length: 40 }, (_, index) => ({
    id: `project-${index}`,
    worktree: `/projects/${index}`,
    name: `Project ${index}`,
    icon: { color: "orange" },
    commands: { start: "bun install" },
    time: { created: 1, updated: 1, active: 1 },
    sandboxes: [],
    worktrees: [],
  }))

  const tracked = { ...projects[0], expanded: true, icon: { override: "local-icon" } }

  const inventory = settingsProjects({
    projects: { list: () => [tracked], closed: () => [projects[1].worktree] },
    sync: { data: { project: projects } },
  })

  expect(inventory).toHaveLength(39)
  expect(inventory[0]).toBe(tracked)
  expect(inventory.some((project) => project.id === projects[1].id)).toBe(false)
  expect(inventory[1]).toEqual({ ...projects[2], expanded: false })
  expect(inventory[38]).toEqual({ ...projects[39], expanded: false })
})

describe("settings server inventory", () => {
  test("includes contributed servers before they connect", () => {
    expect(settingsServers([], [ssh])).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        source: ssh,
      },
    ])
  })

  test("joins a ready contributed server to its live connection and withholds it while disconnected", () => {
    const ready = { ...ssh, entry: { ...ssh.entry, state: "ready" as const } }
    expect(settingsServers([connection], [ready])).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        connection,
        source: ready,
      },
    ])
    expect(settingsServers([connection], [ssh])[0].connection).toBeUndefined()
  })
})

import { afterEach, describe, expect, mock, test } from "bun:test"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Project } from "../../src/project/project"
import { Database } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import * as adaptors from "../../src/control-plane/adaptors"
import type { Adaptor } from "../../src/control-plane/types"

const bash = (input: string) => {
  const drive = input[0].toLowerCase()
  const rest = input.slice(2).replaceAll("\\", "/")
  return `/${drive}${rest}`
}

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

Log.init({ print: false })

const remote = { type: "testing", name: "remote-a" } as unknown as typeof WorkspaceTable.$inferInsert

const TestAdaptor: Adaptor = {
  configure(config) {
    return config
  },
  async create() {
    throw new Error("not used")
  },
  async remove() {},
  async fetch(_config: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"type":"remote.ready","properties":{}}\n\n'))
        controller.close()
      },
    })
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    })
  },
}

adaptors.installAdaptor("testing", TestAdaptor)

describe("control-plane/workspace.startSyncing", () => {
  test("syncs only remote workspaces and emits remote SSE events", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const id1 = WorkspaceID.ascending()
    const id2 = WorkspaceID.ascending()

    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values([
          {
            id: id1,
            branch: "main",
            project_id: project.id,
            type: remote.type,
            name: remote.name,
          },
          {
            id: id2,
            branch: "main",
            project_id: project.id,
            type: "worktree",
            directory: tmp.path,
            name: "local",
          },
        ])
        .run(),
    )

    const done = new Promise<void>((resolve) => {
      const listener = (event: { directory?: string; payload: { type: string } }) => {
        if (event.directory !== id1) return
        if (event.payload.type !== "remote.ready") return
        GlobalBus.off("event", listener)
        resolve()
      }
      GlobalBus.on("event", listener)
    })

    const sync = Workspace.startSyncing(project)
    await Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for sync event")), 2000)),
    ])

    await sync.stop()
  })

  test("stores and rehydrates workspace directories in one stored form", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const dir = process.platform === "win32" ? bash(tmp.path) : tmp.path
    adaptors.installAdaptor("testing-path", {
      ...TestAdaptor,
      configure(config) {
        return {
          ...config,
          directory: dir,
          name: "remote-b",
        }
      },
      async create() {},
    })

    const created = await Workspace.create({
      type: "testing-path",
      branch: null,
      projectID: project.id,
      extra: null,
    })

    const loaded = await Workspace.get(created.id)
    const listed = Workspace.list(project)

    expect(created.directory).toBe(tmp.path)
    expect(loaded?.directory).toBe(tmp.path)
    expect(listed.find((item) => item.id === created.id)?.directory).toBe(tmp.path)
  })
})

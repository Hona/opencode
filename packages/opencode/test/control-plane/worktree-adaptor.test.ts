import { expect, mock, test } from "bun:test"
import path from "path"

import { Path } from "../../src/path/path"
import { ProjectID } from "../../src/project/schema"
import { WorkspaceID } from "../../src/control-plane/schema"

let seen: { workspace: string | null; directory: string | null } | undefined

mock.module("../../src/control-plane/workspace-server/server", () => ({
  WorkspaceServer: {
    App() {
      return {
        fetch(input: Request) {
          seen = {
            workspace: input.headers.get("x-opencode-workspace"),
            directory: input.headers.get("x-opencode-directory"),
          }
          return Promise.resolve(new Response("ok"))
        },
      }
    },
  },
}))

const { WorktreeAdaptor } = await import("../../src/control-plane/adaptors/worktree")

test("worktree adaptor forwards workspace and directory headers", async () => {
  seen = undefined
  const dir = path.join(process.cwd(), "100% ready")

  const res = await WorktreeAdaptor.fetch(
    {
      id: WorkspaceID.parse("wrk_test_workspace"),
      type: "worktree",
      branch: "dev",
      name: "test",
      directory: Path.pretty(dir),
      extra: null,
      projectID: ProjectID.make("project_test"),
    },
    "/event",
  )

  expect(res.status).toBe(200)
  expect(seen).toBeDefined()
  expect(seen!.workspace).toBe("wrk_test_workspace")
  expect(seen!.directory).toBe(dir)
})

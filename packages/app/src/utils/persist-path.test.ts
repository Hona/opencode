import { describe, expect, test } from "bun:test"
import { migrateLayoutPageState, migrateLayoutPaths, migrateServerState } from "./persist-path"

describe("migrateLayoutPaths", () => {
  test("converts legacy sidebar flags and normalizes workspace keys", () => {
    expect(migrateLayoutPaths({ sidebar: { workspaces: true } })).toEqual({
      sidebar: {
        workspaces: {},
        workspacesDefault: true,
      },
    })

    expect(
      migrateLayoutPaths({
        sidebar: {
          workspaces: {
            "C:\\Repo\\": true,
            "c:/repo": false,
            "/tmp/demo///": true,
          },
        },
      }),
    ).toEqual({
      sidebar: {
        workspaces: {
          "c:/repo": false,
          "/tmp/demo": true,
        },
      },
    })
  })
})

describe("migrateLayoutPageState", () => {
  test("keeps path values while normalizing workspace keys", () => {
    expect(
      migrateLayoutPageState({
        activeProject: "C:\\Repo\\",
        activeWorkspace: "C:/Repo/Feature/",
        lastProjectSession: {
          "C:\\Repo\\": { directory: "C:/Repo/Feature/", id: "old", at: 1 },
          "c:/repo": { directory: "c:\\repo\\feature\\", id: "new", at: 2 },
        },
        workspaceOrder: {
          "C:\\Repo\\": ["C:/Repo", "C:/Repo/Feature/", "c:\\repo\\feature\\", "c:\\repo\\other\\"],
        },
        workspaceName: {
          "C:\\Repo\\Feature\\": "feature",
          "c:/repo/feature": "feature latest",
        },
        workspaceExpanded: {
          "C:\\Repo\\": true,
          "c:/repo": false,
        },
      }),
    ).toEqual({
      activeProject: "C:\\Repo\\",
      activeWorkspace: "C:/Repo/Feature/",
      lastProjectSession: {
        "c:/repo": { directory: "c:\\repo\\feature\\", id: "new", at: 2 },
      },
      workspaceOrder: {
        "c:/repo": ["C:/Repo/Feature/", "c:\\repo\\other\\"],
      },
      workspaceName: {
        "c:/repo/feature": "feature latest",
      },
      workspaceExpanded: {
        "c:/repo": false,
      },
    })
  })
})

describe("migrateServerState", () => {
  test("keeps persisted server path values while deduping by key", () => {
    expect(
      migrateServerState({
        projects: {
          local: [
            { worktree: "C:\\Repo\\", expanded: false },
            { worktree: "c:/repo", expanded: true },
            { worktree: "/tmp/demo///", expanded: true },
          ],
        },
        lastProject: {
          local: "C:/Repo/",
        },
      }),
    ).toEqual({
      projects: {
        local: [
          { worktree: "C:\\Repo\\", expanded: true },
          { worktree: "/tmp/demo///", expanded: true },
        ],
      },
      lastProject: {
        local: "C:/Repo/",
      },
    })
  })
})

import z from "zod"
import { Worktree } from "@/worktree"
import { type Adaptor, type WorkspaceFetchInput, WorkspaceInfo } from "../types"

const Config = WorkspaceInfo.extend({
  name: WorkspaceInfo.shape.name.unwrap(),
  branch: WorkspaceInfo.shape.branch.unwrap(),
  directory: WorkspaceInfo.shape.directory.unwrap(),
})

type Config = z.infer<typeof Config>

function config(info: WorkspaceInfo) {
  return Config.parse(info)
}

function request(input: WorkspaceFetchInput, init?: RequestInit) {
  const url = input instanceof URL ? input : input instanceof Request ? new URL(input.url) : new URL(input, "http://opencode.internal")
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return { url, headers }
}

export const WorktreeAdaptor: Adaptor = {
  async configure(info) {
    const worktree = await Worktree.makeWorktreeInfo(info.name ?? undefined)
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const cfg = config(info)
    const bootstrap = await Worktree.createFromInfo({
      name: cfg.name,
      directory: cfg.directory,
      branch: cfg.branch,
    })
    return bootstrap()
  },
  async remove(info) {
    await Worktree.remove({ directory: config(info).directory })
  },
  async fetch(info, input, init) {
    const cfg = config(info)
    const { WorkspaceServer } = await import("../workspace-server/server")
    const req = request(input, init)
    req.headers.set("x-opencode-workspace", cfg.id)
    req.headers.set("x-opencode-directory", cfg.directory)

    return WorkspaceServer.App().fetch(new Request(req.url, { ...init, headers: req.headers }))
  },
}

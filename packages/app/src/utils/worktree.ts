import { workspacePathKey, type WorkspaceKey, type WorkspacePath } from "@/context/file/path"

type State =
  | {
      status: "pending"
    }
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

const key = (directory: WorkspacePath) => workspacePathKey(directory)

const state = new Map<WorkspaceKey, State>()
const waiters = new Map<
  WorkspaceKey,
  {
    promise: Promise<State>
    resolve: (state: State) => void
  }
>()

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

function settle(directory: WorkspacePath, next: Extract<State, { status: "ready" | "failed" }>) {
  const id = key(directory)
  state.set(id, next)

  const waiter = waiters.get(id)
  if (!waiter) return
  waiters.delete(id)
  waiter.resolve(next)
}

export const Worktree = {
  get(directory: WorkspacePath) {
    return state.get(key(directory))
  },
  pending(directory: WorkspacePath) {
    const id = key(directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return
    state.set(id, { status: "pending" })
  },
  ready(directory: WorkspacePath) {
    settle(directory, { status: "ready" })
  },
  failed(directory: WorkspacePath, message: string) {
    settle(directory, { status: "failed", message })
  },
  wait(directory: WorkspacePath) {
    const id = key(directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(id)
    if (existing) return existing.promise

    const waiter = deferred()

    waiters.set(id, waiter)
    return waiter.promise
  },
}

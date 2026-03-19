import type { PrettyPath } from "@/path/schema"

const disposers = new Set<(directory: PrettyPath) => Promise<void>>()

export function registerDisposer(disposer: (directory: PrettyPath) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: PrettyPath) {
  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
}

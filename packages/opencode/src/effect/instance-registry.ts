import type { PrettyPath } from "@/path/schema"

const disposers = new Set<(directory: PrettyPath | string) => Promise<void>>()

export function registerDisposer(disposer: (directory: PrettyPath | string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: PrettyPath | string) {
  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
}

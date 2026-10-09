export * as BrowserServe from "./serve.js"

import { realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

type Root = { readonly token: string; readonly directory: string }

// Local files reach the desktop's tabs as http pages on the server's loopback, which the desktop already reaches
// through its server-network tunnel. Each served folder gets an unguessable path prefix. Served pages share one origin,
// so a page's scripts can read whatever is served: only the file's folder and its subfolders, without dotfiles such as
// `.env` or `.git`, and without symlinks that lead elsewhere.
export const make = Effect.fn("BrowserServe.make")(function* (directory: string) {
  const roots = new Map<string, Root>()
  const state: { server?: ReturnType<typeof Bun.serve>; closed: boolean } = { closed: false }
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      const server = state.server
      state.closed = true
      state.server = undefined
      await server?.stop(true)
    }),
  )

  const start = () => {
    // A tool call still running when the plugin unloads must not start a server nothing will stop.
    if (state.closed) throw new Error("the browser plugin is stopping")
    return (state.server ??= Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      development: false,
      // A malformed escape or an unreadable file answers like a missing one.
      error: () => new Response("Not found", { status: 404 }),
      fetch: async (request) => {
        const [, token, ...rest] = new URL(request.url).pathname.split("/")
        const root = Array.from(roots.values()).find((item) => item.token === token)
        if (!root || (request.method !== "GET" && request.method !== "HEAD"))
          return new Response("Not found", { status: 404 })
        const path = join(root.directory, ...decodeURIComponent(rest.join("/")).split(/[\\/]/).filter(Boolean))
        const file = (await servable(root, path)) ?? (await servable(root, join(path, "index.html")))
        if (!file) return new Response("Not found", { status: 404 })
        const target = Bun.file(file)
        return new Response(request.method === "HEAD" ? null : target, {
          headers: { "content-type": target.type, "cache-control": "no-store" },
        })
      },
    }))
  }

  return {
    /** An http URL the desktop tab can load for a server-local file, serving the folder it lives in. */
    url: (input: string) =>
      Effect.tryPromise({
        try: async () => {
          const path = await realpath(resolve(directory, input))
          if (!(await stat(path)).isFile()) throw new Error("The path names a directory. Pass the HTML file inside it.")
          if (basename(path).startsWith(".")) throw new Error("Dotfiles are not served. Rename the file.")
          const base = dirname(path)
          const root = roots.get(base) ?? { token: crypto.randomUUID(), directory: base }
          roots.set(base, root)
          return `http://127.0.0.1:${start().port}/${root.token}/${encodeURIComponent(basename(path))}`
        },
        catch: (error) =>
          new Tool.Error({
            message: `Cannot serve ${input} to the browser: ${error instanceof Error ? error.message : String(error)}. The path is server-local, relative to the workspace or absolute; check that the file exists on the server.`,
            error,
          }),
      }),
  }
})

export type Serve = Effect.Success<ReturnType<typeof make>>

// A file the root may serve, after symlinks: inside the root, with no part starting with a dot (a dotfile or `..`).
async function servable(root: Root, path: string) {
  const real = await realpath(path).catch(() => undefined)
  if (!real) return undefined
  const rest = relative(root.directory, real)
  if (isAbsolute(rest) || rest.split(sep).some((part) => part.startsWith("."))) return undefined
  return (await stat(real)).isFile() ? real : undefined
}

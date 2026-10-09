export * as BrowserFiles from "./files.js"

import { Browser } from "./rpc.js"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

export type Saved = { id: Browser.FileID; name: string; mime: string; bytes: number; path: string }

const limit = `${Browser.MAX_FILE_BYTES / 1024 / 1024} MiB`

// Files cross machines as bytes. Only this endpoint interprets its local paths.
export const read = Effect.fn("BrowserFiles.read")((paths: readonly string[], directory: string) =>
  Effect.tryPromise({
    try: async () => {
      const { open } = await import("node:fs/promises")
      const { resolve, basename, extname } = await import("node:path")
      const files = await Promise.all(
        paths.map(async (input) => {
          const file = await open(resolve(directory, input), "r")
          try {
            const stat = await file.stat()
            if (!stat.isFile())
              throw new Error("Upload paths must name files, not directories. Select a server-local file.")
            if (stat.size > Browser.MAX_FILE_BYTES)
              throw new Error(
                `Upload is ${stat.size} bytes; the limit is ${Browser.MAX_FILE_BYTES} bytes (${limit}). Select a smaller file; do not retry the same upload.`,
              )
            return {
              id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
              name: basename(input),
              mime: types[extname(input).toLowerCase()] ?? "application/octet-stream",
              data: new Uint8Array(await file.readFile()),
            }
          } finally {
            await file.close()
          }
        }),
      )
      if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
        throw new Error(
          `The selected upload files exceed ${limit} in total. Send fewer or smaller files; splitting them into one batch does not bypass the total limit.`,
        )
      return files
    },
    catch: (error) => failure("read", error),
  }),
)

const types: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
}

/** Fails with a model-facing error when a path the agent named does not exist on the server. */
export const exists = Effect.fn("BrowserFiles.exists")((input: string, directory: string) =>
  Effect.tryPromise({
    try: async () => {
      const { stat } = await import("node:fs/promises")
      const { resolve } = await import("node:path")
      await stat(resolve(directory, input))
    },
    catch: (error) =>
      new Tool.Error({
        message: `Nothing exists at ${input} on the server, so there is nothing to show. Paths are server-local, relative to the workspace or absolute; check the path you wrote the file to.`,
        error,
      }),
  }),
)

/**
 * Resolves a path the agent asked to save to. The plugin cannot ask for edit permission, so the path must stay inside
 * the workspace, through symlinks too, and must not name an existing file that this plugin did not save itself.
 */
export const destination = Effect.fn("BrowserFiles.destination")(
  (input: string, directory: string, written: ReadonlySet<string>) =>
    Effect.tryPromise({
      try: async () => {
        const { lstat, realpath } = await import("node:fs/promises")
        const { dirname, isAbsolute, relative, resolve, sep } = await import("node:path")
        const path = resolve(directory, input)
        const within = (root: string, target: string) => {
          const rest = relative(root, target)
          return !isAbsolute(rest) && rest.split(sep)[0] !== ".."
        }
        // The nearest folder that exists decides where a new file really lands. A broken symlink exists but has no real
        // path, and the folders it would create are wherever it points, so it fails instead.
        const existing = async (folder: string): Promise<string> =>
          realpath(folder).catch(async (error: unknown) => {
            if (
              dirname(folder) === folder ||
              (await lstat(folder).then(
                () => true,
                () => false,
              ))
            )
              throw error
            return existing(dirname(folder))
          })
        if (!within(directory, path) || !within(await realpath(directory), await existing(dirname(path))))
          throw new Error(
            "the path is outside the workspace. Browser saves skip edit permissions, so they stay in the workspace. Pass a workspace path, or omit it to save a temporary file and move that with your file tools.",
          )
        const found = await lstat(path).catch(() => undefined)
        // A file this plugin saved may be replaced, unless something swapped it for a link since.
        if (found && (!written.has(path) || found.isSymbolicLink()))
          throw new Error(
            "a file already exists there, and the browser replaces only files it saved itself. Pass a new path, or omit it to save a temporary file.",
          )
        return path
      },
      catch: (error) =>
        new Tool.Error({
          message: `Cannot save to ${input}: ${error instanceof Error ? error.message : String(error)}`,
          error,
        }),
    }),
)

/**
 * Saves returned bytes on the server. With a destination from `destination`, the single file goes to that path (parent
 * folders are created) and joins `written`; otherwise each file gets its own temporary directory.
 */
export const save = Effect.fn("BrowserFiles.save")(
  (files: readonly Browser.File[], destination?: { path: string; written: Set<string> }) =>
    Effect.tryPromise({
      try: async (): Promise<Saved[]> => {
        if (files.length === 0) return []
        if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
          throw new Error(
            `Capture files exceed the ${limit} total transfer limit. Use a smaller screenshot, a shorter trace/profile, or a smaller page for heap capture; do not retry the identical capture.`,
          )
        const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises")
        const { dirname, join } = await import("node:path")
        const { tmpdir } = await import("node:os")
        if (destination) {
          const file = files[0]!
          const path = destination.path
          await mkdir(dirname(path), { recursive: true })
          // "wx" also refuses a file that appeared after the destination was checked.
          await writeFile(path, file.data, { flag: destination.written.has(path) ? "w" : "wx" })
          destination.written.add(path)
          return [{ id: file.id, name: file.name, mime: file.mime, bytes: file.data.byteLength, path }]
        }
        const directory = await mkdtemp(join(tmpdir(), "opencode-browser-"))
        return Promise.all(
          files.map(async (file, index) => {
            const name = captureName(file.name)
            await mkdir(join(directory, String(index)))
            const path = join(directory, String(index), name)
            await writeFile(path, file.data, { flag: "wx" })
            return { id: file.id, name: file.name, mime: file.mime, bytes: file.data.byteLength, path }
          }),
        )
      },
      catch: (error) => failure("save", error),
    }),
)

// `.`/`..` escape the per-file directory and Windows resolves device names such as CON.txt regardless of directory.
export function captureName(name: string) {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160)
  if (!sanitized || /^\.{1,2}$/.test(sanitized) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(sanitized))
    return "capture"
  return sanitized
}

function failure(operation: "read" | "save", error: unknown) {
  const detail = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string" && !detail.startsWith(error.code)
      ? `${error.code}: `
      : ""
  const recovery =
    operation === "save"
      ? "The browser may have completed the capture, but no server-local export is confirmed. Check free space and write access on the server. Use browser.files.list({tabID}) and browser.files.get({tabID,id}) to retrieve an existing completed capture instead of repeating its browser action."
      : "Upload paths are on the server, not the desktop. Check that each path exists, is a file, and is readable on the server; correct paths or select smaller files before retrying."
  return new Tool.Error({
    message: `Cannot ${operation} browser files on the server. ${recovery} Details: ${code}${detail}`,
    error,
  })
}

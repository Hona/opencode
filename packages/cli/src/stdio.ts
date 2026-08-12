let installed = false

export function guardStdio() {
  if (installed) return
  installed = true
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (isEpipe(error)) return
      throw error
    })
  }
  process.on("uncaughtException", (error, origin) => {
    if (isEpipe(error)) return
    console.error(origin, error)
    process.exit(1)
  })
  process.on("unhandledRejection", (reason) => {
    if (isEpipe(reason)) return
    console.error("unhandledRejection", reason)
    process.exit(1)
  })
}

const isEpipe = (error: unknown) => error instanceof Error && "code" in error && error.code === "EPIPE"

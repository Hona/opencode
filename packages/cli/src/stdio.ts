let installed = false

export function guardStdio() {
  if (installed) return
  installed = true
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (error instanceof Error && "code" in error && error.code === "EPIPE") return
      throw error
    })
  }
}

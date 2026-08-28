import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"

assert.equal(process.platform, "win32")
assert.equal(process.arch, process.argv[4], "The runtime must use the runner's native architecture")
assert.equal(process.argv[3], `@lydell/node-pty-${process.platform}-${process.arch}`)

// Resolve only from the isolated installation, not the monorepo's dependencies.
const require = createRequire(path.resolve(process.argv[2], "package.json"))

for (const name of ["@lydell/node-pty", process.argv[3]]) {
  const terminal = require(name).spawn("cmd.exe", ["/d", "/c", "echo opencode-pty-smoke&exit /b 23"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  })
  const chunks = []
  const done = Promise.withResolvers()
  const data = terminal.onData((chunk) => chunks.push(chunk))
  const exit = terminal.onExit(done.resolve)
  const timer = setTimeout(() => {
    done.reject(new Error(`${name}: PTY did not exit within 15 seconds`))
  }, 15_000)

  try {
    const result = await done.promise
    assert.equal(result.exitCode, 23, `${name}: unexpected exit status`)
    assert.ok(chunks.join("").includes("opencode-pty-smoke"), `${name}: missing PTY output`)
    console.log(
      `${process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`} ${process.arch}: ${name} passed`,
    )
  } finally {
    clearTimeout(timer)
    data.dispose()
    exit.dispose()
    // Release ConPTY's worker and handles even after the shell has exited.
    terminal.kill()
  }
}

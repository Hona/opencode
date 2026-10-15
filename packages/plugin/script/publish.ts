#!/usr/bin/env bun
import { Script } from "@opencode/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

// Exports only the workspace imports: the app's and desktop's internal protocol, which npm users never see. Each maps
// to null, so the `./*` export cannot reach it either.
const workspaceOnly = ["./gui/host"]

// A clean build, so no file an earlier build emitted, such as one now left out, reaches the package.
await $`rm -rf dist`
await $`bun run build`
const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string | { import: string; types: string } | null>
  imports: Record<string, Record<string, string>>
}
if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  pkg.exports = {
    ...Object.fromEntries(
      Object.entries(pkg.exports).map(([key, value]) => {
        if (workspaceOnly.includes(key)) return [key, null]
        const file = String(value).replace("./src/", "./dist/").replace(".ts", "")
        return [key, { import: file + ".js", types: file + ".d.ts" }]
      }),
    ),
  }
  pkg.imports = Object.fromEntries(
    Object.entries(pkg.imports).map(([key, conditions]) => [
      key,
      Object.fromEntries(
        Object.entries(conditions).map(([condition, value]) => [
          condition,
          value.replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
        ]),
      ),
    ]),
  )
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  try {
    await $`bun pm pack`
    await $`npm publish *.tgz --tag ${Script.channel} --access public`
  } finally {
    await Bun.write("package.json", originalText)
  }
}

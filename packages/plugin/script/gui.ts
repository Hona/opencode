#!/usr/bin/env bun

// Builds `@opencode/plugin/gui`, the SDK a plugin's `./gui` bundle builds against, into dist/gui. Its sources live in
// packages/gui-extensions beside the built-in GUI plugins, so this copies their declarations and code, plus the icon
// catalog the declarations name, into this package: one npm package then serves server, TUI and GUI plugins. The app
// provides these modules at runtime, so a GUI bundle keeps them external.

import { $ } from "bun"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const source = path.join(plugin, "../gui-extensions")
const output = path.join(plugin, "dist/gui")
const catalog = path.join(plugin, "../ui/src/icons/catalog.ts")

// Each public entry and its source under packages/gui-extensions/src.
const entries = {
  "./gui": "sdk/index",
  "./gui/main": "sdk/main",
  "./gui/file": "file/contract",
  "./gui/review": "review/contract",
  "./gui/browser": "browser/contract",
  "./gui/updater": "updater/contract",
}

// Package names the sources use, as authors import them.
const names = [
  ["@opencode/gui-extensions/sdk/main", "@opencode/plugin/gui/main"],
  ["@opencode/gui-extensions/sdk", "@opencode/plugin/gui"],
  ["@opencode/gui-extensions/file", "@opencode/plugin/gui/file"],
  ["@opencode/gui-extensions/review", "@opencode/plugin/gui/review"],
  ["@opencode/gui-extensions/browser", "@opencode/plugin/gui/browser"],
  ["@opencode/gui-extensions/updater", "@opencode/plugin/gui/updater"],
] as const

/** Builds dist/gui and returns the package exports that point at it. */
export async function buildGui() {
  await rm(output, { recursive: true, force: true })

  await $`bunx tsgo -p ${path.join(source, "tsconfig.build.json")} --outDir ${output}`

  await $`bunx tsgo ${catalog} --ignoreConfig --declaration --emitDeclarationOnly --rootDir ${path.dirname(catalog)} --outDir ${path.join(output, "icons")} --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck`

  const built = await Bun.build({
    entrypoints: Object.values(entries).map((entry) => path.join(source, "src", `${entry}.ts`)),
    root: path.join(source, "src"),
    outdir: output,
    format: "esm",
    target: "browser",
    splitting: true,
    packages: "external",
  })

  if (!built.success) throw new AggregateError(built.logs, "GUI SDK build failed")

  const files = await Array.fromAsync(new Bun.Glob("**/*.{js,d.ts}").scan({ cwd: output, absolute: true }))
  await Promise.all(files.map(async (file) => Bun.write(file, rewrite(file, await Bun.file(file).text()))))

  return Object.fromEntries(
    Object.entries(entries).map(([entry, file]) => [
      entry,
      { types: `./dist/gui/${file}.d.ts`, import: `./dist/gui/${file}.js` },
    ]),
  )
}

/** Points a built file's imports inside the package: the icon catalog, extensionless relative paths, and the SDK's names. */
function rewrite(file: string, text: string) {
  const named = names.reduce((result, [from, to]) => result.replaceAll(`"${from}"`, `"${to}"`), text)

  const icons = path.relative(path.dirname(file), path.join(output, "icons/catalog.js")).replaceAll("\\", "/")

  return named
    .replaceAll('"@opencode/ui/icons/catalog"', `"${icons.startsWith(".") ? icons : `./${icons}`}"`)
    .replace(/(from |import\()"(\.{1,2}\/[^"]*?)"/g, (match, prefix: string, specifier: string) => {
      if (/\.js$/.test(specifier)) return match
      const target = path.resolve(path.dirname(file), specifier)

      if (existsSync(`${target}.d.ts`) || existsSync(`${target}.js`)) return `${prefix}"${specifier}.js"`

      return `${prefix}"${specifier}/index.js"`
    })
}

if (import.meta.main) console.log(await buildGui())

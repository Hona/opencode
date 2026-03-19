import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Path } from "../path/path"
import { Instance } from "../project/instance"
import type { PathKey, PrettyPath } from "@/path/schema"
import { Flag } from "@/flag/flag"
import { Log } from "../util/log"
import { Glob } from "../util/glob"
import type { MessageV2 } from "./message-v2"

const log = Log.create({ service: "instruction" })

const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md", // deprecated
]

function globalFiles() {
  const files = []
  if (Flag.OPENCODE_CONFIG_DIR) {
    files.push(Path.pretty("AGENTS.md", { cwd: Flag.OPENCODE_CONFIG_DIR }))
  }
  files.push(Path.pretty("AGENTS.md", { cwd: Global.Path.config }))
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(Path.expand("~/.claude/CLAUDE.md"))
  }
  return files
}

async function resolveRelative(instruction: string): Promise<string[]> {
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
  }
  if (!Flag.OPENCODE_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no OPENCODE_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.OPENCODE_CONFIG_DIR, Flag.OPENCODE_CONFIG_DIR).catch(() => [])
}

export namespace InstructionPrompt {
  const state = Instance.state(() => {
    return {
      claims: new Map<string, Set<PathKey>>(),
    }
  })

  function isClaimed(messageID: string, filepath: PathKey) {
    const claimed = state().claims.get(messageID)
    if (!claimed) return false
    return claimed.has(filepath)
  }

  function claim(messageID: string, filepath: PathKey) {
    const current = state()
    let claimed = current.claims.get(messageID)
    if (!claimed) {
      claimed = new Set()
      current.claims.set(messageID, claimed)
    }
    claimed.add(filepath)
  }

  export function clear(messageID: string) {
    state().claims.delete(messageID)
  }

  export async function systemPaths() {
    const config = await Config.get()
    const paths = new Set<PrettyPath>()

    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for (const file of FILES) {
        const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        if (matches.length > 0) {
          matches.forEach((p) => {
            paths.add(Path.pretty(p))
          })
          break
        }
      }
    }

    for (const file of globalFiles()) {
      if (await Filesystem.exists(file)) {
        paths.add(Path.pretty(file))
        break
      }
    }

    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) continue
        instruction = Path.expand(instruction)
        const file = Path.isAbsolute(instruction) ? Path.pretty(instruction) : undefined
        const matches = file
          ? await Glob.scan(path.basename(file), {
              cwd: path.dirname(file),
              absolute: true,
              include: "file",
            }).catch(() => [])
          : await resolveRelative(instruction)
        matches.forEach((p) => {
          paths.add(Path.pretty(p))
        })
      }
    }

    return paths
  }

  export async function system() {
    const config = await Config.get()
    const paths = await systemPaths()

    const files = Array.from(paths).map(async (p) => {
      const content = await Filesystem.readText(p).catch(() => "")
      return content ? "Instructions from: " + p + "\n" + content : ""
    })

    const urls: string[] = []
    if (config.instructions) {
      for (const instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
        }
      }
    }
    const fetches = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )

    return Promise.all([...files, ...fetches]).then((result) => result.filter(Boolean))
  }

  export function loaded(messages: MessageV2.WithParts[]) {
    const paths = new Set<PathKey>()
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
          if (part.state.time.compacted) continue
          const loaded = part.state.metadata?.loaded
          if (!loaded || !Array.isArray(loaded)) continue
          for (const p of loaded) {
            if (typeof p === "string") paths.add(Path.key(p))
          }
        }
      }
    }
    return paths
  }

  export async function find(dir: string) {
    for (const file of FILES) {
      const filepath = Path.pretty(file, { cwd: dir })
      if (await Filesystem.exists(filepath)) return filepath
    }
  }

  export async function resolve(messages: MessageV2.WithParts[], filepath: PrettyPath, messageID: string) {
    const system = new Set(Array.from(await systemPaths(), (item) => Path.key(item)))
    const already = loaded(messages)
    const results: { filepath: PrettyPath; content: string }[] = []

    const target = Path.truecaseSync(filepath)
    const targetKey = Path.key(target)
    const root = Path.truecaseSync(Instance.directory)
    const rootKey = Path.key(root)

    for (const dir of Path.up(Path.parent(target), { stop: root })) {
      if (Path.key(dir) === rootKey) break
      const found = await find(dir)
      if (!found) continue
      const hit = Path.truecaseSync(found)
      const hitKey = Path.key(hit)

      if (hitKey === targetKey || system.has(hitKey) || already.has(hitKey) || isClaimed(messageID, hitKey)) continue
      claim(messageID, hitKey)
      const content = await Filesystem.readText(hit).catch(() => undefined)
      if (!content) continue
      results.push({ filepath: Path.pretty(hit), content: "Instructions from: " + hit + "\n" + content })
    }

    return results
  }
}

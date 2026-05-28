import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs"
import { execFileSync } from "child_process"
import os from "os"
import path from "path"
import * as PathStorage from "@/util/path-identity/storage"

describe("PathIdentity storage", () => {
  test("converts Windows absolute paths to forward slashes without resolving junctions", () => {
    if (process.platform !== "win32") return

    const root = mkdtempSync(path.join(os.tmpdir(), "opencode-path-identity-"))
    try {
      const target = path.join(root, "target")
      const child = path.join(target, "child")
      const junction = path.join(root, "junction")
      mkdirSync(child, { recursive: true })
      symlinkSync(target, junction, "junction")

      expect(String(PathStorage.absolutePath(path.join(junction, "child")))).toBe(
        path.join(junction, "child").replaceAll("\\", "/"),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("converts Windows drive aliases to forward slashes without resolving them", () => {
    if (process.platform !== "win32") return

    const drive = Array.from("ZYXWVUTSRQPONM").find((letter) => !existsSync(`${letter}:\\`))
    if (!drive) return

    const root = mkdtempSync(path.join(os.tmpdir(), "opencode-path-identity-"))
    try {
      mkdirSync(path.join(root, "child"), { recursive: true })
      execFileSync("subst", [`${drive}:`, root], { stdio: "ignore" })

      expect(String(PathStorage.absolutePath(`${drive}:\\child`))).toBe(`${drive}:/child`)
    } finally {
      try {
        execFileSync("subst", [`${drive}:`, "/D"], { stdio: "ignore" })
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  })
})

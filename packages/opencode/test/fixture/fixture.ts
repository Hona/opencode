import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

const GIT_TEMPLATE = [
  {
    path: ".git/config",
    content:
      "W2NvcmVdCglyZXBvc2l0b3J5Zm9ybWF0dmVyc2lvbiA9IDAKCWZpbGVtb2RlID0gZmFsc2UKCWJhcmUgPSBmYWxzZQoJbG9nYWxscmVmdXBkYXRlcyA9IHRydWUKCWlnbm9yZWNhc2UgPSB0cnVlCg==",
  },
  {
    path: ".git/description",
    content: "VW5uYW1lZCByZXBvc2l0b3J5OyBlZGl0IHRoaXMgZmlsZSAnZGVzY3JpcHRpb24nIHRvIG5hbWUgdGhlIHJlcG9zaXRvcnkuCg==",
  },
  {
    path: ".git/HEAD",
    content: "cmVmOiByZWZzL2hlYWRzL21hc3Rlcgo=",
  },
  {
    path: ".git/info/exclude",
    content:
      "IyBnaXQgbHMtZmlsZXMgLS1vdGhlcnMgLS1leGNsdWRlLWZyb209LmdpdC9pbmZvL2V4Y2x1ZGUKIyBMaW5lcyB0aGF0IHN0YXJ0IHdpdGggJyMnIGFyZSBjb21tZW50cy4KIyBGb3IgYSBwcm9qZWN0IG1vc3RseSBpbiBDLCB0aGUgZm9sbG93aW5nIHdvdWxkIGJlIGEgZ29vZCBzZXQgb2YKIyBleGNsdWRlIHBhdHRlcm5zICh1bmNvbW1lbnQgdGhlbSBpZiB5b3Ugd2FudCB0byB1c2UgdGhlbSk6CiMgKi5bb2FdCiMgKn4K",
  },
  {
    path: ".git/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904",
    content: "eAErKUpNVTBgAAAKLAIB",
  },
  {
    path: ".git/objects/57/47945c9cea2d26bb461e85f2f92fde96a86069",
    content:
      "eAGtzk0KwjAQQGHXOcXsC2US0/yAiAsXLlx4hSSdWqntSJoI3t6CV3D7Fh8v8Tw/CiiFu5KJQEenuj4ZrVI0FH1Ag9TpOLjeeOXcEIm0Ry1CLSNnuNaJbiFPlM/0hoNEvUfnsbnwEk51pby2C2d6PT/t/VHGGtvE8xGktdJJa7yFRiKi2Or2Ueh/osjMBX6u+AJw/EeI",
  },
  {
    path: ".git/refs/heads/master",
    content: "NTc0Nzk0NWM5Y2VhMmQyNmJiNDYxZTg1ZjJmOTJmZGU5NmE4NjA2OQo=",
  },
]

let gitTemplatePromise: Promise<string> | undefined
async function getGitTemplate() {
  if (gitTemplatePromise) return gitTemplatePromise
  gitTemplatePromise = (async () => {
    const templatePath = path.join(
      os.tmpdir(),
      "opencode-git-template-" + process.pid + "-" + Math.random().toString(36).slice(2),
    )
    for (const file of GIT_TEMPLATE) {
      const fullPath = path.join(templatePath, file.path)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, Buffer.from(file.content, "base64"))
    }
    return templatePath
  })()
  return gitTemplatePromise
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    const templatePath = await getGitTemplate()
    await fs.cp(templatePath, dirpath, { recursive: true })
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // await fs.rm(dirpath, { recursive: true, force: true })
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}

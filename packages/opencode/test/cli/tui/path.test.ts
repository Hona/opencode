import { describe, expect, test } from "bun:test"
import { formatPath, formatServerPath, plugin, serverPathKey, splitPath } from "../../../src/cli/cmd/tui/util/path"

describe("tui path", () => {
  test("formats Windows absolute paths without a leading slash", () => {
    expect(
      formatPath("/C:/Users/me/code/opencode", {
        platform: "win32",
      }),
    ).toBe("C:\\Users\\me\\code\\opencode")
  })

  test("keeps cwd-relative paths relative before shortening home", () => {
    expect(
      formatPath("C:\\Users\\me\\code\\opencode\\src\\file.ts", {
        cwd: "C:\\Users\\me\\code\\opencode",
        home: "C:\\Users\\me",
        platform: "win32",
        relative: true,
      }),
    ).toBe("src\\file.ts")
  })

  test("formats server-relative paths without local cwd fallback", () => {
    expect(
      formatServerPath("src/file.ts", {
        os: "linux",
      }),
    ).toBe("src/file.ts")

    expect(
      formatServerPath("src/file.ts", {
        directory: "C:\\Users\\me\\code\\opencode",
        home: "C:\\Users\\me",
        os: "windows",
      }, { relative: true }),
    ).toBe("src\\file.ts")
  })

  test("keys server paths with server cwd semantics", () => {
    expect(
      serverPathKey("src\\FILE.ts", {
        directory: "C:\\Users\\me\\code\\opencode",
        os: "windows",
      }),
    ).toBe("c:\\users\\me\\code\\opencode\\src\\file.ts")

    expect(
      serverPathKey("src\\FILE.ts", {
        os: "windows",
      }),
    ).toBe("src/file.ts")
  })

  test("shortens home with directory boundaries", () => {
    expect(
      formatPath("C:\\Users\\me\\code\\opencode", {
        home: "C:\\Users\\me",
        platform: "win32",
      }),
    ).toBe("~\\code\\opencode")

    expect(
      formatPath("C:\\Users\\meow\\code\\opencode", {
        home: "C:\\Users\\me",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\meow\\code\\opencode")
  })

  test("splits display paths with native separators", () => {
    expect(splitPath("C:\\Users\\me\\code\\opencode", { platform: "win32" })).toEqual({
      dir: "C:\\Users\\me\\code\\",
      base: "opencode",
    })
  })

  test("extracts plugin names from file uris safely", () => {
    expect(plugin("file:///C:/Users/me/.config/opencode/plugins/demo/index.ts", { platform: "win32" })).toEqual({
      name: "demo",
    })

    expect(plugin("file:///C:/Users/me/.config/opencode/plugins/local.ts", { platform: "win32" })).toEqual({
      name: "local",
    })
  })
})

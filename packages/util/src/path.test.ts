import { describe, expect, test } from "bun:test"
import { getDirectory, getFilename, getPathSeparator } from "./path"

describe("path display helpers", () => {
  test("keeps posix separators in displayed directories", () => {
    expect(getDirectory("src/components/app.tsx")).toBe("src/components/")
    expect(getDirectory("/tmp/demo/app.ts")).toBe("/tmp/demo/")
  })

  test("keeps windows separators in displayed directories", () => {
    expect(getDirectory("src\\components\\app.tsx")).toBe("src\\components\\")
    expect(getDirectory("C:\\repo\\src\\app.tsx")).toBe("C:\\repo\\src\\")
    expect(getDirectory("\\\\server\\share\\repo\\app.tsx")).toBe("\\\\server\\share\\repo\\")
  })

  test("extracts filenames across separator styles", () => {
    expect(getFilename("src/components/app.tsx")).toBe("app.tsx")
    expect(getFilename("src\\components\\app.tsx")).toBe("app.tsx")
  })

  test("infers native-looking separators for windows paths", () => {
    expect(getPathSeparator("/tmp/demo")).toBe("/")
    expect(getPathSeparator("C:/repo/src/app.tsx")).toBe("\\")
    expect(getPathSeparator("\\\\server\\share\\repo")).toBe("\\")
  })
})

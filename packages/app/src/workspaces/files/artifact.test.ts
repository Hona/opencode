import { describe, expect, test } from "bun:test"
import { artifactKind, bytesToBase64, fileContentFromBytes, resolveArtifactPath } from "./artifact"

describe("artifactKind", () => {
  test.each([
    ["shot.PNG", "image"],
    ["logo.svg", "svg"],
    ["song.mp3", "audio"],
    ["demo.mp4", "video"],
    ["clip.webm", "video"],
    ["paper.pdf", "pdf"],
    ["out/index.html", "html"],
    ["README.md", "markdown"],
    ["src/app.ts", "text"],
    ["Makefile", "text"],
    [".env", "text"],
    ["archive.tar.gz", "text"],
  ] as const)("classifies %s as %s", (path, kind) => {
    expect(artifactKind(path)).toBe(kind)
  })
})

describe("fileContentFromBytes", () => {
  test("keeps media as base64 with a mime type", () => {
    const content = fileContentFromBytes("a.png", new Uint8Array([137, 80, 78, 71]))
    expect(content).toEqual({ type: "binary", content: "iVBORw==", encoding: "base64", mimeType: "image/png" })
  })

  test("decodes text and svg with a mime type", () => {
    expect(fileContentFromBytes("a.svg", new TextEncoder().encode("<svg/>"))).toEqual({
      type: "text",
      content: "<svg/>",
      mimeType: "image/svg+xml",
    })
    expect(fileContentFromBytes("a.ts", new TextEncoder().encode("const a = 1"))).toEqual({
      type: "text",
      content: "const a = 1",
      mimeType: undefined,
    })
  })

  test("marks unknown binaries without keeping bytes", () => {
    expect(fileContentFromBytes("a.bin", new Uint8Array([1, 0, 2]))).toEqual({ type: "binary", content: "" })
  })

  test("encodes large buffers in chunks", () => {
    const bytes = new Uint8Array(70_000).fill(65)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"))
  })
})

describe("resolveArtifactPath", () => {
  test.each([
    ["docs", "guide.md", "docs/guide.md"],
    ["docs", "./img/a.png", "docs/img/a.png"],
    ["docs/api", "../index.md", "docs/index.md"],
    ["", "src/app.ts", "src/app.ts"],
    ["docs", "sub\\win.md", "docs/sub/win.md"],
  ])("resolves %s + %s", (base, href, expected) => {
    expect(resolveArtifactPath(base, href)).toBe(expected)
  })

  test.each([
    ["docs", "../../etc/passwd"],
    ["", "../x"],
    ["docs", "/abs/path"],
  ])("rejects %s + %s", (base, href) => {
    expect(resolveArtifactPath(base, href)).toBeUndefined()
  })
})

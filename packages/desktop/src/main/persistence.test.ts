import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openDesktopPersistence } from "./persistence"

const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "opencode-desktop-persistence-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined)),
  )
})

describe("desktop persistence", () => {
  test("reads, commits, and removes documents", async () => {
    const root = await tempRoot()
    const persistence = openDesktopPersistence(join(root, "desktop.db"))

    expect(persistence.read("global", "theme")).toBeNull()
    persistence.commit("global", "theme", '"dark"')
    expect(persistence.read("global", "theme")).toBe('"dark"')
    persistence.commit("global", "theme", '"light"')
    expect(persistence.read("global", "theme")).toBe('"light"')
    persistence.remove("global", "theme")
    expect(persistence.read("global", "theme")).toBeNull()

    persistence.close()
  })

  test("stores blobs by digest and verifies reads", async () => {
    const root = await tempRoot()
    const path = join(root, "desktop.db")
    const persistence = openDesktopPersistence(path)
    const bytes = new TextEncoder().encode("hello")

    const reference = persistence.putBlob(bytes)
    expect(reference).toEqual({
      digest: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      byteLength: 5,
    })
    expect(persistence.putBlob(bytes)).toEqual(reference)
    expect(persistence.readBlob(reference.digest, reference.byteLength)).toEqual(bytes)

    const database = new DatabaseSync(path)
    database.prepare("UPDATE blob SET byte_length = 1 WHERE digest = ?").run(reference.digest)
    database.close()
    expect(() => persistence.readBlob(reference.digest, reference.byteLength)).toThrow("Blob reference mismatch")

    const corrupted = new DatabaseSync(path)
    corrupted
      .prepare("UPDATE blob SET bytes = ?, byte_length = ? WHERE digest = ?")
      .run(new TextEncoder().encode("world"), reference.byteLength, reference.digest)
    corrupted.close()
    expect(() => persistence.readBlob(reference.digest, reference.byteLength)).toThrow("Blob digest mismatch")
    persistence.close()
  })

  test("imports electron stores once without replacing newer documents", async () => {
    const root = await tempRoot()
    const history = JSON.stringify([
      {
        prompt: [
          {
            type: "image",
            id: "image-1",
            filename: "image.png",
            mime: "image/png",
            dataUrl: "data:image/png;base64,aGVsbG8=",
          },
        ],
        comments: [],
      },
    ])
    await writeFile(join(root, "opencode.global.dat"), JSON.stringify({ theme: '"dark"', count: 2, history }))
    await writeFile(join(root, "opencode.settings"), JSON.stringify({ serverUrl: "http://localhost" }))
    const persistence = openDesktopPersistence(join(root, "desktop.db"))

    persistence.commit("opencode.global.dat", "theme", '"newer"')
    persistence.importElectronStores(root)
    expect(persistence.read("opencode.global.dat", "theme")).toBe('"newer"')
    expect(persistence.read("opencode.global.dat", "count")).toBe("2")
    expect(persistence.read("opencode.settings", "serverUrl")).toBe("http://localhost")
    expect(JSON.parse(persistence.read("opencode.global.dat", "history")!)[0].prompt[0]).toEqual({
      type: "image",
      id: "image-1",
      filename: "image.png",
      mime: "image/png",
      blob: {
        digest: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        byteLength: 5,
      },
    })

    await writeFile(join(root, "opencode.global.dat"), JSON.stringify({ added: true }))
    persistence.importElectronStores(root)
    expect(persistence.read("opencode.global.dat", "added")).toBeNull()
    persistence.close()
  })

  test("prunes stale drafts and unreferenced blobs", async () => {
    const root = await tempRoot()
    const path = join(root, "desktop.db")
    const persistence = openDesktopPersistence(path)
    const stale = persistence.putBlob(new TextEncoder().encode("stale"))
    const retained = persistence.putBlob(new TextEncoder().encode("retained"))
    const orphaned = persistence.putBlob(new TextEncoder().encode("orphaned"))
    persistence.commit("opencode.draft.stale.dat", "draft:prompt", JSON.stringify({ blob: stale }))
    persistence.commit("opencode.draft.recent.dat", "draft:prompt", JSON.stringify({ blob: retained }))

    const database = new DatabaseSync(path)
    const now = Date.now()
    database
      .prepare("UPDATE document SET updated_at = ? WHERE storage = ?")
      .run(now - 31 * 24 * 60 * 60 * 1000, "opencode.draft.stale.dat")
    database.close()

    expect(persistence.cleanup(now)).toEqual({ drafts: 1, blobs: 2 })
    expect(persistence.read("opencode.draft.stale.dat", "draft:prompt")).toBeNull()
    expect(persistence.read("opencode.draft.recent.dat", "draft:prompt")).not.toBeNull()
    expect(persistence.readBlob(stale.digest)).toBeNull()
    expect(persistence.readBlob(orphaned.digest)).toBeNull()
    expect(persistence.readBlob(retained.digest)).not.toBeNull()
    persistence.close()
  })

  test("keeps the newest 100 drafts", async () => {
    const root = await tempRoot()
    const path = join(root, "desktop.db")
    const persistence = openDesktopPersistence(path)
    const now = Date.now()
    const drafts = Array.from({ length: 101 }, (_, index) => index)
    drafts.forEach((index) => {
      persistence.commit(`opencode.draft.${index}.dat`, "draft:prompt", `{"index":${index}}`)
    })
    const database = new DatabaseSync(path)
    const update = database.prepare("UPDATE document SET updated_at = ? WHERE storage = ?")
    drafts.forEach((index) => update.run(now - index, `opencode.draft.${index}.dat`))
    database.close()

    expect(persistence.cleanup(now).drafts).toBe(1)
    expect(persistence.read("opencode.draft.0.dat", "draft:prompt")).not.toBeNull()
    expect(persistence.read("opencode.draft.100.dat", "draft:prompt")).toBeNull()
    persistence.close()
  })
})

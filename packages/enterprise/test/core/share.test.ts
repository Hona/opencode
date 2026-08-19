import { describe, expect, test } from "bun:test"
import { Share } from "../../src/core/share"

let sequence = 0
const sessionID = () => `test_session_${++sequence}`

function session(sessionID: string): Share.Data {
  return {
    type: "session",
    data: {
      id: sessionID,
      projectID: "project_story",
      title: "Current Session share",
      location: { directory: "C:/workspaces/opencode" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    },
  }
}

function messages(sessionID: string, text: string): Share.Data {
  return {
    type: "messages",
    data: {
      sessionID,
      messages: [
        {
          id: "msg_share_user",
          type: "user",
          text,
          time: { created: 1 },
        },
      ],
    },
  }
}

describe.concurrent("core.share", () => {
  test("creates and removes a share", async () => {
    const id = sessionID()
    const share = await Share.create({ sessionID: id })

    expect(share.sessionID).toBe(id)
    expect(share.secret).toBeDefined()

    await Share.remove({ id: share.id, secret: share.secret })
    expect(await Share.get(share.id)).toBeUndefined()
  })

  test("removes a share as an administrator", async () => {
    const share = await Share.create({ sessionID: sessionID() })
    await Share.removeAdmin({ id: share.id })
    expect(await Share.get(share.id)).toBeUndefined()
  })

  test("stores one ordered current message batch", async () => {
    const id = sessionID()
    const share = await Share.create({ sessionID: id })

    await Share.sync({ share, data: [session(id), messages(id, "Inspect the current renderer.")] })

    expect(await Share.data(share.id)).toEqual([messages(id, "Inspect the current renderer."), session(id)])
    await Share.remove(share)
  })

  test("replaces a message batch without merging transcript items by ID", async () => {
    const id = sessionID()
    const share = await Share.create({ sessionID: id })

    await Share.sync({ share, data: [messages(id, "First prompt")] })
    await Share.sync({ share, data: [messages(id, "Updated prompt")] })

    expect(await Share.data(share.id)).toEqual([messages(id, "Updated prompt")])
    await Share.remove(share)
  })

  test("preserves independent current snapshot values across syncs", async () => {
    const id = sessionID()
    const share = await Share.create({ sessionID: id })
    const diffs = {
      type: "session_diff" as const,
      data: [
        {
          file: "src/session.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
          status: "modified" as const,
        },
      ],
    }

    await Share.sync({ share, data: [session(id), messages(id, "Update the Session."), diffs] })
    await Share.sync({ share, data: [{ type: "model", data: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }] }] })

    expect((await Share.data(share.id)).map((item) => item.type)).toEqual([
      "messages",
      "model",
      "session",
      "session_diff",
    ])
    await Share.remove(share)
  })

  test("returns an empty snapshot before the first sync", async () => {
    const share = await Share.create({ sessionID: sessionID() })
    expect(await Share.data(share.id)).toEqual([])
    await Share.remove(share)
  })

  test("rejects invalid credentials and unknown shares", async () => {
    const id = sessionID()
    const share = await Share.create({ sessionID: id })
    const data = [messages(id, "Protected prompt")]

    expect(Share.sync({ share: { ...share, secret: "invalid" }, data })).rejects.toThrow()
    expect(Share.sync({ share: { id: "missing", secret: "missing" }, data })).rejects.toThrow()

    await Share.remove(share)
  })
})

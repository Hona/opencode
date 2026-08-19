import type { FileDiffInfo, SessionInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import z from "zod"
import { Storage } from "./storage"

function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  return (input: z.infer<T>) => cb(schema.parse(input))
}

export namespace Share {
  export type SessionDiff = FileDiffInfo
  export type Model = { id: string; name: string }
  export type SessionRecord = SessionInfo
  export type Message = SessionMessageInfo
  export type Messages = { sessionID: string; messages: Message[] }

  export const Info = z.object({
    id: z.string(),
    secret: z.string(),
    sessionID: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const Data = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session"),
      data: z.custom<SessionRecord>(),
    }),
    z.object({
      type: z.literal("messages"),
      data: z.custom<Messages>(),
    }),
    z.object({
      type: z.literal("session_diff"),
      data: z.custom<SessionDiff[]>(),
    }),
    z.object({
      type: z.literal("model"),
      data: z.custom<Model[]>(),
    }),
  ])
  export type Data = z.infer<typeof Data>

  type Snapshot = {
    data: Data[]
  }

  function key(item: Data) {
    switch (item.type) {
      case "session":
        return "session"
      case "messages":
        return `messages/${item.data.sessionID}`
      case "session_diff":
        return "session_diff"
      case "model":
        return "model"
    }
    throw new Error(`Unknown share data: ${JSON.stringify(item)}`)
  }

  function merge(...items: Data[][]) {
    const map = new Map<string, Data>()
    for (const list of items) {
      for (const item of list) {
        map.set(key(item), item)
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => item)
  }

  async function readSnapshot(shareID: string) {
    return (await Storage.read<Snapshot>(["share_snapshot", shareID]))?.data
  }

  async function writeSnapshot(shareID: string, data: Data[]) {
    await Storage.write(["share_snapshot", shareID], { data } satisfies Snapshot)
  }

  export const create = fn(z.object({ sessionID: z.string() }), async (body) => {
    const isTest = process.env.NODE_ENV === "test" || body.sessionID.startsWith("test_")
    const info: Info = {
      id: (isTest ? "test_" : "") + body.sessionID.slice(-8),
      sessionID: body.sessionID,
      secret: crypto.randomUUID(),
    }
    const exists = await get(info.id)
    if (exists) throw new Errors.AlreadyExists(info.id)
    await Promise.all([Storage.write(["share", info.id], info), writeSnapshot(info.id, [])])
    return info
  })

  export async function get(id: string) {
    return Storage.read<Info>(["share", id])
  }

  export const remove = fn(Info.pick({ id: true, secret: true }), async (body) => {
    const share = await get(body.id)
    if (!share) throw new Errors.NotFound(body.id)
    if (share.secret !== body.secret) throw new Errors.InvalidSecret(body.id)
    await Promise.all([Storage.remove(["share", body.id]), Storage.remove(["share_snapshot", body.id])])
  })

  export const removeAdmin = fn(Info.pick({ id: true }), async (body) => {
    const share = await get(body.id)
    if (!share) throw new Errors.NotFound(body.id)
    await remove({ id: share.id, secret: share.secret })
  })

  export const sync = fn(
    z.object({
      share: Info.pick({ id: true, secret: true }),
      data: Data.array(),
    }),
    async (input) => {
      const share = await get(input.share.id)
      if (!share) throw new Errors.NotFound(input.share.id)
      if (share.secret !== input.share.secret) throw new Errors.InvalidSecret(input.share.id)
      const data = (await readSnapshot(input.share.id)) ?? []
      await writeSnapshot(input.share.id, merge(data, input.data))
    },
  )

  export async function data(shareID: string) {
    return (await readSnapshot(shareID)) ?? []
  }

  export const Errors = {
    NotFound: class extends Error {
      constructor(public id: string) {
        super(`Share not found: ${id}`)
      }
    },
    InvalidSecret: class extends Error {
      constructor(public id: string) {
        super(`Share secret invalid: ${id}`)
      }
    },
    AlreadyExists: class extends Error {
      constructor(public id: string) {
        super(`Share already exists: ${id}`)
      }
    },
  }
}

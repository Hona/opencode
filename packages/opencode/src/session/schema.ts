import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const SessionID = Schema.String.pipe(
  Schema.brand("SessionID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    parse: (id: string) => s.makeUnsafe(Identifier.parse("session", id)),
    assert: (id: string): asserts id is Schema.Schema.Type<typeof s> => {
      Identifier.assert("session", id)
    },
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("session", id)),
    zod: Identifier.schema<Schema.Schema.Type<typeof s>>("session"),
  })),
)

export type SessionID = Schema.Schema.Type<typeof SessionID>

export const MessageID = Schema.String.pipe(
  Schema.brand("MessageID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    parse: (id: string) => s.makeUnsafe(Identifier.parse("message", id)),
    assert: (id: string): asserts id is Schema.Schema.Type<typeof s> => {
      Identifier.assert("message", id)
    },
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("message", id)),
    zod: Identifier.schema<Schema.Schema.Type<typeof s>>("message"),
  })),
)

export type MessageID = Schema.Schema.Type<typeof MessageID>

export const PartID = Schema.String.pipe(
  Schema.brand("PartID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    parse: (id: string) => s.makeUnsafe(Identifier.parse("part", id)),
    assert: (id: string): asserts id is Schema.Schema.Type<typeof s> => {
      Identifier.assert("part", id)
    },
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("part", id)),
    zod: Identifier.schema<Schema.Schema.Type<typeof s>>("part"),
  })),
)

export type PartID = Schema.Schema.Type<typeof PartID>

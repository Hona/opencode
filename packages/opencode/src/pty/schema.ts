import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

const ptyIdSchema = Schema.String.pipe(Schema.brand("PtyID"))

export type PtyID = typeof ptyIdSchema.Type

export const PtyID = ptyIdSchema.pipe(
  withStatics((schema: typeof ptyIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(Identifier.parse("pty", id)),
    assert: (id: string): asserts id is PtyID => {
      Identifier.assert("pty", id)
    },
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("pty", id)),
    zod: Identifier.schema<PtyID>("pty"),
  })),
)

import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

const toolIdSchema = Schema.String.pipe(Schema.brand("ToolID"))

export type ToolID = typeof toolIdSchema.Type

export const ToolID = toolIdSchema.pipe(
  withStatics((schema: typeof toolIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(Identifier.parse("tool", id)),
    assert: (id: string): asserts id is ToolID => {
      Identifier.assert("tool", id)
    },
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("tool", id)),
    zod: Identifier.schema<ToolID>("tool"),
  })),
)

import { Schema } from "effect"

import { withStatics, zodFrom } from "@/util/schema"

function parse(id: string) {
  if (!id) throw new TypeError("Expected project id, received empty string")
  return id
}

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))

export type ProjectID = typeof projectIdSchema.Type

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.makeUnsafe("global"),
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(parse(id)),
    assert: (id: string): asserts id is ProjectID => {
      parse(id)
    },
    zod: zodFrom((id) => schema.makeUnsafe(parse(id))),
  })),
)

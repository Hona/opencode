import { Schema } from "effect"

import { withStatics } from "@/util/schema"
import { Identifier } from "@/id/id"

const workspaceIdSchema = Schema.String.pipe(Schema.brand("WorkspaceID"))

export type WorkspaceID = typeof workspaceIdSchema.Type

export const WorkspaceID = workspaceIdSchema.pipe(
  withStatics((schema: typeof workspaceIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(Identifier.parse("workspace", id)),
    assert: (id: string): asserts id is WorkspaceID => {
      Identifier.assert("workspace", id)
    },
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("workspace", id)),
    zod: Identifier.schema<WorkspaceID>("workspace"),
  })),
)

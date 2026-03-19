import { Schema } from "effect"

import { withStatics, zodFrom } from "@/util/schema"

function parse(id: string, label: string) {
  if (!id) throw new TypeError(`Expected ${label}, received empty string`)
  return id
}

const providerIdSchema = Schema.String.pipe(Schema.brand("ProviderID"))

export type ProviderID = typeof providerIdSchema.Type

export const ProviderID = providerIdSchema.pipe(
  withStatics((schema: typeof providerIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(parse(id, "provider id")),
    assert: (id: string): asserts id is ProviderID => {
      parse(id, "provider id")
    },
    zod: zodFrom((id) => schema.makeUnsafe(parse(id, "provider id"))),
    // Well-known providers
    opencode: schema.makeUnsafe("opencode"),
    anthropic: schema.makeUnsafe("anthropic"),
    openai: schema.makeUnsafe("openai"),
    google: schema.makeUnsafe("google"),
    googleVertex: schema.makeUnsafe("google-vertex"),
    githubCopilot: schema.makeUnsafe("github-copilot"),
    amazonBedrock: schema.makeUnsafe("amazon-bedrock"),
    azure: schema.makeUnsafe("azure"),
    openrouter: schema.makeUnsafe("openrouter"),
    mistral: schema.makeUnsafe("mistral"),
    gitlab: schema.makeUnsafe("gitlab"),
  })),
)

const modelIdSchema = Schema.String.pipe(Schema.brand("ModelID"))

export type ModelID = typeof modelIdSchema.Type

export const ModelID = modelIdSchema.pipe(
  withStatics((schema: typeof modelIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    parse: (id: string) => schema.makeUnsafe(parse(id, "model id")),
    assert: (id: string): asserts id is ModelID => {
      parse(id, "model id")
    },
    zod: zodFrom((id) => schema.makeUnsafe(parse(id, "model id"))),
  })),
)

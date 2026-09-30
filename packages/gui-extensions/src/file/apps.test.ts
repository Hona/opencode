import { expect, test } from "bun:test"
import { Schema } from "effect"
import { OPEN_APPS, OpenAppPreferences } from "./apps"

const decode = Schema.decodeUnknownSync(OpenAppPreferences)

test.each([...OPEN_APPS])("preserves the stored %s preference", (app) => {
  expect(decode({ app })).toEqual({ app })
})

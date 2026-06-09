import { expect, test } from "bun:test"
import config from "./electron-builder.config"

test("uses a path-safe Linux executable name", () => {
  expect(config.linux).toEqual(
    expect.objectContaining({
      executableName: "opencode-desktop",
    }),
  )
})

import { describe, expect, test } from "bun:test"
import { windowBootstrapArgument, windowBootstrapFromArguments } from "./window-bootstrap"

describe("window bootstrap", () => {
  test("round-trips through argv", () => {
    const bootstrap = { id: "win a/b ü", firstLaunchPending: false, defaultServerUrl: "http://127.0.0.1:1234" }
    expect(windowBootstrapFromArguments(["electron", windowBootstrapArgument(bootstrap)])).toEqual(bootstrap)
  })
})

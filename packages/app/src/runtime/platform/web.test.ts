import { afterEach, expect, test } from "bun:test"
import { getCurrentServerUrl } from "./web"

const href = window.location.href

afterEach(() => {
  window.location.href = href
})

test.each(["beta.opencode.ai", "app.opencode.ai", "app.dev.opencode.ai"])(
  "%s defaults to the V2 managed service port",
  (hostname) => {
    window.location.href = `https://${hostname}`
    expect(getCurrentServerUrl()).toBe("http://localhost:49374")
  },
)

test.each(["http://127.0.0.1:4096", "https://opencode.example.test"])(
  "%s keeps its own origin as the server URL",
  (origin) => {
    window.location.href = `${origin}/project/session`
    expect(getCurrentServerUrl()).toBe(origin)
  },
)

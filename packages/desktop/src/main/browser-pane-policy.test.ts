import { expect, test } from "bun:test"
import { allowedDestination, destinationOrigin, localEndpoint, localFileURL, normalizeURL } from "./browser/policy"

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example")
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000")
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(url)).toBeUndefined()
  }
})

test("file documents load only for local servers and never from a host", () => {
  expect(localFileURL("file:///C:/work/out/report.html")).toBe("file:///C:/work/out/report.html")
  expect(localFileURL("file:///tmp/report.html")).toBe("file:///tmp/report.html")
  expect(localFileURL("file://server/share/report.html")).toBeUndefined()
  expect(localFileURL("https://example.com")).toBeUndefined()

  expect(allowedDestination("file:///tmp/report.html")).toBe(false)
  expect(allowedDestination("file:///tmp/report.html", { file: true })).toBe(true)
  expect(allowedDestination("file://server/share/report.html", { file: true })).toBe(false)
  expect(allowedDestination("javascript:alert(1)", { file: true })).toBe(false)

  expect(normalizeURL("file:///tmp/report.html", { file: true })).toBe("file:///tmp/report.html")
  expect(() => normalizeURL("file:///tmp/report.html")).toThrow()
  expect(normalizeURL("localhost:3000", { file: true })).toBe("http://localhost:3000")
})

test("recognizes loopback server endpoints", () => {
  expect(localEndpoint("http://127.0.0.1:4096")).toBe(true)
  expect(localEndpoint("http://localhost:4096")).toBe(true)
  expect(localEndpoint("http://[::1]:4096")).toBe(true)
  expect(localEndpoint("https://dev.example.com")).toBe(false)
  expect(localEndpoint("not a url")).toBe(false)
})

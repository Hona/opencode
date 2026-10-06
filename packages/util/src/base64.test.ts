import { describe, expect, test } from "bun:test"
import { base64ToBytes, bytesToBase64 } from "./base64.js"

describe("base64", () => {
  test("round-trips buffers larger than one encoding chunk", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256)
    const encoded = bytesToBase64(bytes)

    expect(encoded).toBe(Buffer.from(bytes).toString("base64"))
    expect(base64ToBytes(encoded)).toEqual(bytes)
  })
})

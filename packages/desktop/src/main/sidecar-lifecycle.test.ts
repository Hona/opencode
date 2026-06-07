import { expect, test } from "bun:test"
import { createSidecarLifecycle, isUnexpectedCurrentSidecar } from "./sidecar-lifecycle"

test("classifies an unrequested sidecar exit as unexpected", async () => {
  const lifecycle = createSidecarLifecycle()

  lifecycle.exited(1)

  expect(await lifecycle.exit).toEqual({ code: 1, expected: false })
})

test("classifies an exit after stop begins as expected", async () => {
  const lifecycle = createSidecarLifecycle()

  lifecycle.stopping()
  lifecycle.exited(0)

  expect(await lifecycle.exit).toEqual({ code: 0, expected: true })
})

test("ignores an unexpected exit from a replaced sidecar", () => {
  const exited = {}
  const replacement = {}

  expect(isUnexpectedCurrentSidecar(exited, exited, { code: 1, expected: false })).toBe(true)
  expect(isUnexpectedCurrentSidecar(replacement, exited, { code: 1, expected: false })).toBe(false)
  expect(isUnexpectedCurrentSidecar(exited, exited, { code: 0, expected: true })).toBe(false)
})

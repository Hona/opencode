import z from "zod"
import { randomBytes } from "crypto"

export namespace Identifier {
  export const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
    workspace: "wrk",
  } as const

  export type Prefix = keyof typeof prefixes

  function label(prefix: Prefix) {
    return `${prefix} id`
  }

  function issue(prefix: Prefix, input: string) {
    if (!input) return `Expected ${label(prefix)}, received empty string`
    if (!input.startsWith(prefixes[prefix])) {
      return `Expected ${label(prefix)} starting with "${prefixes[prefix]}", received "${input}"`
    }
  }

  export function is(prefix: Prefix, input: string): boolean {
    return !issue(prefix, input)
  }

  export function assert(prefix: Prefix, input: string): asserts input is string {
    const err = issue(prefix, input)
    if (err) throw new TypeError(err)
  }

  export function parse(prefix: Prefix, input: string): string {
    assert(prefix, input)
    return input
  }

  export function schema<T extends string>(prefix: Prefix) {
    return z.string().transform((input, ctx) => {
      const err = issue(prefix, input)
      if (!err) return input as T
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err,
      })
      return z.NEVER
    })
  }

  const LENGTH = 26

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending(prefix: Prefix, given?: string) {
    return generateID(prefix, false, given)
  }

  export function descending(prefix: Prefix, given?: string) {
    return generateID(prefix, true, given)
  }

  function generateID(prefix: Prefix, descending: boolean, given?: string): string {
    if (!given) return create(prefix, descending)
    return parse(prefix, given)
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""
    const bytes = randomBytes(length)
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % 62]
    }
    return result
  }

  export function create(prefix: Prefix, descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    now = descending ? ~now : now

    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const prefix = id.split("_")[0]
    const hex = id.slice(prefix.length + 1, prefix.length + 13)
    const encoded = BigInt("0x" + hex)
    return Number(encoded / BigInt(0x1000))
  }
}

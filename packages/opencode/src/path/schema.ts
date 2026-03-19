import { Schema } from "effect"
import path from "path"

import { withStatics, zodFrom } from "@/util/schema"

/**
 * These brands document which path shape a string is expected to already be in.
 * The `make` helpers are intentionally unsafe; normalization lives in
 * `src/path/path.ts`, while the brands keep different path forms from being
 * mixed up by accident.
 */

// Absolute, normalized, native-separator path used for most internal work.
const prettyPathSchema = Schema.String.pipe(Schema.brand("PrettyPath"))

function platform() {
  return process.platform === "win32" ? path.win32 : path.posix
}

function parsePretty(input: string) {
  if (!input) throw new TypeError("Expected absolute filesystem path, received empty string")
  if (!platform().isAbsolute(input)) {
    throw new TypeError(`Expected absolute filesystem path, received "${input}"`)
  }
  return prettyPathSchema.makeUnsafe(input)
}

function parseKey(input: string) {
  parsePretty(input)
  return pathKeySchema.makeUnsafe(input)
}

function parsePosix(input: string) {
  if (!input) throw new TypeError("Expected POSIX path, received empty string")
  if (input.includes("\\")) throw new TypeError(`Expected POSIX path without backslashes, received "${input}"`)
  return posixPathSchema.makeUnsafe(input)
}

function parseRelative(input: string) {
  if (!input) throw new TypeError("Expected relative path, received empty string")
  if (platform().isAbsolute(input)) throw new TypeError(`Expected relative path, received "${input}"`)
  return relativePathSchema.makeUnsafe(input)
}

function parseRepo(input: string) {
  if (!input) throw new TypeError("Expected repository path, received empty string")
  if (input.includes("\\")) throw new TypeError(`Expected repository path with forward slashes, received "${input}"`)
  if (path.posix.isAbsolute(input)) throw new TypeError(`Expected repository-relative path, received "${input}"`)
  return repoPathSchema.makeUnsafe(input)
}

function parseURI(input: string) {
  if (!input) throw new TypeError("Expected file URI, received empty string")
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError(`Expected file URI, received "${input}"`)
  }
  if (url.protocol !== "file:") throw new TypeError(`Expected file URI, received "${input}"`)
  return fileUriSchema.makeUnsafe(input)
}

export type PrettyPath = typeof prettyPathSchema.Type

export const PrettyPath = prettyPathSchema.pipe(
  withStatics((schema: typeof prettyPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parsePretty,
    assert: (input: string): asserts input is PrettyPath => {
      parsePretty(input)
    },
    zod: zodFrom(parsePretty),
  })),
)

// Equality/map key form. Windows values are case-folded before branding.
const pathKeySchema = Schema.String.pipe(Schema.brand("PathKey"))

export type PathKey = typeof pathKeySchema.Type

export const PathKey = pathKeySchema.pipe(
  withStatics((schema: typeof pathKeySchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parseKey,
    assert: (input: string): asserts input is PathKey => {
      parseKey(input)
    },
    zod: zodFrom(parseKey),
  })),
)

// POSIX-slash form used where platform-neutral serialization matters.
const posixPathSchema = Schema.String.pipe(Schema.brand("PosixPath"))

export type PosixPath = typeof posixPathSchema.Type

export const PosixPath = posixPathSchema.pipe(
  withStatics((schema: typeof posixPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parsePosix,
    assert: (input: string): asserts input is PosixPath => {
      parsePosix(input)
    },
    zod: zodFrom(parsePosix),
  })),
)

// Relative path produced from one already-normalized path to another.
const relativePathSchema = Schema.String.pipe(Schema.brand("RelativePath"))

export type RelativePath = typeof relativePathSchema.Type

export const RelativePath = relativePathSchema.pipe(
  withStatics((schema: typeof relativePathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parseRelative,
    assert: (input: string): asserts input is RelativePath => {
      parseRelative(input)
    },
    zod: zodFrom(parseRelative),
  })),
)

// Repository-relative path with stable forward slashes and optional trailing `/`.
const repoPathSchema = Schema.String.pipe(Schema.brand("RepoPath"))

export type RepoPath = typeof repoPathSchema.Type

export const RepoPath = repoPathSchema.pipe(
  withStatics((schema: typeof repoPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parseRepo,
    assert: (input: string): asserts input is RepoPath => {
      parseRepo(input)
    },
    zod: zodFrom(parseRepo),
  })),
)

// `file://` URI string derived from a normalized filesystem path.
const fileUriSchema = Schema.String.pipe(Schema.brand("FileURI"))

export type FileURI = typeof fileUriSchema.Type

export const FileURI = fileUriSchema.pipe(
  withStatics((schema: typeof fileUriSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
    parse: parseURI,
    assert: (input: string): asserts input is FileURI => {
      parseURI(input)
    },
    zod: zodFrom(parseURI),
  })),
)

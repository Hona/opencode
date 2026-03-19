import { Schema } from "effect"

import { withStatics } from "@/util/schema"

/**
 * These brands document which path shape a string is expected to already be in.
 * The `make` helpers are intentionally unsafe; normalization lives in
 * `src/path/path.ts`, while the brands keep different path forms from being
 * mixed up by accident.
 */

// Absolute, normalized, native-separator path used for most internal work.
const prettyPathSchema = Schema.String.pipe(Schema.brand("PrettyPath"))

export type PrettyPath = typeof prettyPathSchema.Type

export const PrettyPath = prettyPathSchema.pipe(
  withStatics((schema: typeof prettyPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

// Equality/map key form. Windows values are case-folded before branding.
const pathKeySchema = Schema.String.pipe(Schema.brand("PathKey"))

export type PathKey = typeof pathKeySchema.Type

export const PathKey = pathKeySchema.pipe(
  withStatics((schema: typeof pathKeySchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

// POSIX-slash form used where platform-neutral serialization matters.
const posixPathSchema = Schema.String.pipe(Schema.brand("PosixPath"))

export type PosixPath = typeof posixPathSchema.Type

export const PosixPath = posixPathSchema.pipe(
  withStatics((schema: typeof posixPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

// Relative path produced from one already-normalized path to another.
const relativePathSchema = Schema.String.pipe(Schema.brand("RelativePath"))

export type RelativePath = typeof relativePathSchema.Type

export const RelativePath = relativePathSchema.pipe(
  withStatics((schema: typeof relativePathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

// Repository-relative path with stable forward slashes and optional trailing `/`.
const repoPathSchema = Schema.String.pipe(Schema.brand("RepoPath"))

export type RepoPath = typeof repoPathSchema.Type

export const RepoPath = repoPathSchema.pipe(
  withStatics((schema: typeof repoPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

// `file://` URI string derived from a normalized filesystem path.
const fileUriSchema = Schema.String.pipe(Schema.brand("FileURI"))

export type FileURI = typeof fileUriSchema.Type

export const FileURI = fileUriSchema.pipe(
  withStatics((schema: typeof fileUriSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

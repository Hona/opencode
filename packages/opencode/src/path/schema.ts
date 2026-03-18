import { Schema } from "effect"

import { withStatics } from "@/util/schema"

const prettyPathSchema = Schema.String.pipe(Schema.brand("PrettyPath"))

export type PrettyPath = typeof prettyPathSchema.Type

export const PrettyPath = prettyPathSchema.pipe(
  withStatics((schema: typeof prettyPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

const pathKeySchema = Schema.String.pipe(Schema.brand("PathKey"))

export type PathKey = typeof pathKeySchema.Type

export const PathKey = pathKeySchema.pipe(
  withStatics((schema: typeof pathKeySchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

const posixPathSchema = Schema.String.pipe(Schema.brand("PosixPath"))

export type PosixPath = typeof posixPathSchema.Type

export const PosixPath = posixPathSchema.pipe(
  withStatics((schema: typeof posixPathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

const relativePathSchema = Schema.String.pipe(Schema.brand("RelativePath"))

export type RelativePath = typeof relativePathSchema.Type

export const RelativePath = relativePathSchema.pipe(
  withStatics((schema: typeof relativePathSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

const fileUriSchema = Schema.String.pipe(Schema.brand("FileURI"))

export type FileURI = typeof fileUriSchema.Type

export const FileURI = fileUriSchema.pipe(
  withStatics((schema: typeof fileUriSchema) => ({
    make: (input: string) => schema.makeUnsafe(input),
  })),
)

import { expect, test } from "bun:test"
import { Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { ClientApi } from "../src/client.js"
import { LocationNotFoundError } from "../src/errors.js"

test("location errors omit an absent workspace ID", () => {
  expect(
    Schema.encodeSync(LocationNotFoundError)(
      new LocationNotFoundError({ directory: "/missing", workspaceID: undefined, message: "Missing directory" }),
    ),
  ).toEqual({ _tag: "LocationNotFoundError", directory: "/missing", message: "Missing directory" })
})

test("only location.get declares LocationNotFoundError", () => {
  const document = OpenApi.fromApi(ClientApi)
  const paths = Object.entries(document.paths).filter(([, operation]) =>
    JSON.stringify(operation).includes("LocationNotFoundError"),
  )
  expect(paths.map(([path]) => path)).toEqual(["/api/location"])
  expect(document.paths["/api/location"]?.get?.responses?.["404"]).toMatchObject({
    description: "LocationNotFoundError",
  })
})

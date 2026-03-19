import { describe, expect, test } from "bun:test"
import z from "zod"

import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

describe("task tool schema", () => {
  test("exports task_id as a JSON-schema-safe string", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const schema = z.toJSONSchema(tool.parameters)

        expect(schema).toMatchObject({
          type: "object",
          properties: {
            task_id: {
              type: "string",
            },
          },
        })
      },
    })
  })
})

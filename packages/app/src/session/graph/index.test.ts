import { describe, expect, test } from "bun:test"
import { createSessionGraph } from "."

describe("session graph", () => {
  test("resolves the root of a complete lineage", () => {
    const graph = createSessionGraph([{ id: "root" }, { id: "child", parentID: "root" }, { id: "leaf", parentID: "child" }])

    expect(graph.resolveRoot("leaf")).toEqual({ status: "resolved", rootID: "root" })
  })

  test("reports the missing ancestor of an incomplete lineage", () => {
    const graph = createSessionGraph([{ id: "leaf", parentID: "child" }])

    expect(graph.resolveRoot("leaf")).toEqual({ status: "incomplete", missingID: "child" })
  })

  test("reports cyclic lineages", () => {
    const graph = createSessionGraph([{ id: "child", parentID: "root" }, { id: "root", parentID: "child" }])

    expect(graph.resolveRoot("child")).toEqual({ status: "cycle", ids: ["child", "root"] })
  })

  test("collects only the cached subtree", () => {
    const graph = createSessionGraph([{ id: "root" }, { id: "child", parentID: "root" }, { id: "leaf", parentID: "child" }])

    expect([...graph.cachedSubtreeIDs("root")]).toEqual(["root", "child", "leaf"])
  })

  test("finds the direct child on an active path", () => {
    const graph = createSessionGraph([{ id: "root" }, { id: "child", parentID: "root" }, { id: "leaf", parentID: "child" }])

    expect(graph.childOnPath("root", "leaf")).toBe("child")
  })
})

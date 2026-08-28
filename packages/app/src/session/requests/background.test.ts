import { describe, expect, test } from "bun:test"
import type {
  JsonValue,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  ShellInfo,
} from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSessionBackground } from "./background"

const tool = (
  id: string,
  name: string,
  metadata: Record<string, JsonValue>,
  input: Record<string, JsonValue> = {},
  status: "completed" | "running" = "completed",
): SessionMessageAssistantTool => ({
  id,
  name,
  type: "tool",
  state:
    status === "running"
      ? { status, input, metadata }
      : { status, input, metadata, content: [{ type: "text", text: "backgrounded" }] },
  time: { created: 0 },
})

const assistant = (
  id: string,
  content: SessionMessageAssistant["content"],
  completed?: number,
): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: 0, completed },
})

const session = (id: string, title?: string, parentID = "root"): SessionInfo => ({
  id,
  title,
  parentID,
  projectID: "project",
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
})

const shell = (id: string, command: string, sessionID = "root"): ShellInfo => ({
  id,
  command,
  status: "running",
  cwd: "/project",
  shell: "sh",
  file: "output",
  metadata: { sessionID },
  time: { started: 0 },
})

describe("createSessionBackground", () => {
  test("filters notifications before and after tools using shell part IDs, not shell IDs", () => {
    createRoot((dispose) => {
      const messages: SessionMessageInfo[] = [
        {
          id: "before",
          type: "synthetic",
          text: "complete",
          metadata: { source: "subagent", childID: "before-child" },
          time: { created: 0 },
        },
        assistant("assistant", [
          tool("shell-done", "shell", { status: "running", shellID: "process-done" }),
          tool("before-tool", "subagent", { status: "running", sessionID: "before-child" }),
          tool("after-tool", "subagent", { status: "running", sessionID: "after-child" }),
          tool("child-tool", "subagent", { status: "running", sessionID: "child" }, { agent: "explore" }),
          tool("shell-kept", "shell", { status: "running", shellID: "process-kept" }, { command: "build" }),
          tool("shell-fallback", "shell", { status: "running", shellID: 123 }, { command: false }),
          tool("invalid-child", "subagent", { status: "running", sessionID: 123 }),
          tool("finished-child", "subagent", { status: "completed", sessionID: "finished" }),
          tool("other-tool", "read", { status: "running" }),
        ]),
        {
          id: "after-child",
          type: "synthetic",
          text: "complete",
          metadata: { source: "subagent", childID: "after-child" },
          time: { created: 1 },
        },
        {
          id: "after-shell",
          type: "synthetic",
          text: "complete",
          metadata: { source: "shell", jobID: "shell-done" },
          time: { created: 2 },
        },
        {
          id: "shell-process",
          type: "synthetic",
          text: "not a tool ID",
          metadata: { source: "shell", jobID: "process-kept" },
          time: { created: 3 },
        },
        {
          id: "unrelated",
          type: "synthetic",
          text: "not a completion",
          metadata: { source: "other", childID: "child", jobID: "shell-fallback" },
          time: { created: 4 },
        },
      ]
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => messages,
        sessions: () => [],
        status: () => "idle",
        shells: () => [],
      })

      expect(background.tasks()).toEqual([
        { id: "child", type: "subagent", label: "child", agent: "explore" },
        { id: "process-kept", type: "shell", label: "build" },
        { id: "shell-fallback", type: "shell", label: "shell-fallback" },
      ])
      expect(background.blocking()).toEqual([])
      dispose()
    })
  })

  test("keeps category order and the last value at each ID's first insertion position", () => {
    createRoot((dispose) => {
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          assistant("assistant", [
            tool("shell-part", "shell", { status: "running", shellID: "shell" }, { command: "old shell" }),
            tool("child-part", "subagent", { status: "running", sessionID: "child" }, { agent: "explore" }),
            tool("duplicate-1", "subagent", { status: "running", sessionID: "duplicate" }, { description: "first" }),
            tool("shared-child", "subagent", { status: "running", sessionID: "shared" }),
            tool("duplicate-2", "subagent", { status: "running", sessionID: "duplicate" }, { description: "last" }),
            tool("shared-shell", "shell", { status: "running", shellID: "shared" }, { command: "shared shell" }),
          ]),
        ],
        sessions: () => [session("child", "live child"), session("shared"), session("live-child")],
        status: () => "running",
        shells: () => [shell("shell", "live shell"), shell("live-shell", "new shell")],
      })

      expect(background.tasks()).toEqual([
        { id: "child", type: "subagent", label: "live child" },
        { id: "duplicate", type: "subagent", label: "last", agent: undefined },
        { id: "shared", type: "shell", label: "shared shell" },
        { id: "live-child", type: "subagent", label: "live-child" },
        { id: "shell", type: "shell", label: "live shell" },
        { id: "live-shell", type: "shell", label: "new shell" },
      ])
      expect(background.tasks()[0]).not.toHaveProperty("agent")
      dispose()
    })
  })

  test("blocks live tasks by ID or nonempty label only from the latest incomplete assistant", () => {
    createRoot((dispose) => {
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [
          assistant("earlier", [
            tool("old", "subagent", { sessionID: "old-child" }, {}, "running"),
            tool("historical", "subagent", { status: "running", sessionID: "blocked-child" }),
          ]),
          assistant("current", [
            tool("child-id", "subagent", { sessionID: "blocked-child" }, {}, "running"),
            tool("child-label", "subagent", {}, { description: "child label" }, "running"),
            tool("shell-id", "shell", { shellID: "blocked-shell" }, {}, "running"),
            tool("shell-label", "shell", {}, { command: "shell label" }, "running"),
            tool("empty-label", "subagent", { sessionID: false }, { description: "" }, "running"),
            tool("unrelated", "read", {}, {}, "running"),
          ]),
          assistant("completed", [tool("newer", "subagent", { sessionID: "old-child" }, {}, "running")], 0),
        ],
        sessions: () => [
          session("blocked-child", "different title"),
          session("label-child", "child label"),
          session("old-child", "shell label"),
          session("empty-child", ""),
          session("idle-child"),
          session("other-child", undefined, "other"),
        ],
        status: (id) => (id === "idle-child" ? "idle" : "running"),
        shells: () => [
          shell("blocked-shell", "different command"),
          shell("label-shell", "shell label"),
          shell("kept-shell", "child label"),
          shell("other-shell", "other", "other"),
          { ...shell("exited-shell", "exited"), status: "exited" },
        ],
      })

      expect(background.blocking()).toEqual([
        { type: "subagent", partID: "child-id", id: "blocked-child", label: undefined },
        { type: "subagent", partID: "child-label", id: undefined, label: "child label" },
        { type: "shell", partID: "shell-id", id: "blocked-shell", label: undefined },
        { type: "shell", partID: "shell-label", id: undefined, label: "shell label" },
        { type: "subagent", partID: "empty-label", id: undefined, label: "" },
      ])
      expect(background.tasks()).toEqual([
        { id: "blocked-child", type: "subagent", label: "blocked-child", agent: undefined },
        { id: "old-child", type: "subagent", label: "shell label" },
        { id: "empty-child", type: "subagent", label: "" },
        { id: "kept-shell", type: "shell", label: "child label" },
      ])
      dispose()
    })
  })

  test("joins live status and labels without rescanning history, including while the parent is idle", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        messages: [assistant("assistant", [tool("child-part", "subagent", { status: "running", sessionID: "saved" })])],
        sessions: [session("child", "child")],
        status: { root: "idle", child: "idle" } as Record<string, "idle" | "running">,
        shells: [{ ...shell("shell", "command"), status: "exited" as ShellInfo["status"] }],
      })
      let scans = 0
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => {
          scans += 1
          return store.messages
        },
        sessions: () => store.sessions,
        status: (id) => store.status[id],
        shells: () => store.shells,
      })
      const blocking = background.blocking()
      const saved = background.tasks()[0]
      expect(scans).toBe(1)

      setStore("status", "child", "running")
      expect(background.tasks().map((task) => task.id)).toEqual(["saved", "child"])
      setStore("shells", 0, "status", "running")
      expect(background.tasks().map((task) => task.id)).toEqual(["saved", "child", "shell"])
      setStore("sessions", 0, "title", "renamed")
      setStore("shells", 0, "command", "updated command")
      expect(background.tasks().map((task) => task.label)).toEqual(["saved", "renamed", "updated command"])
      expect(background.tasks()[0]).toBe(saved)
      expect(background.blocking()).toBe(blocking)
      expect(store.status.root).toBe("idle")
      expect(scans).toBe(1)

      setStore("status", "child", "idle")
      setStore("shells", 0, "status", "exited")
      expect(background.tasks()).toEqual([saved])
      expect(scans).toBe(1)
      dispose()
    })
  })

  test("tracks nested tool and notification updates without replacing the messages array", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        messages: [assistant("assistant", [tool("part", "subagent", { sessionID: "child" }, {}, "running")])],
        notifications: [
          {
            id: "notification",
            type: "synthetic" as const,
            text: "complete",
            metadata: { source: "other", childID: "child" },
            time: { created: 1 },
          },
        ],
      })
      const messages = store.messages
      const background = createSessionBackground({
        sessionID: () => "root",
        messages: () => [...store.messages, ...store.notifications],
        sessions: () => [],
        status: () => "idle",
        shells: () => [],
      })
      expect(background.blocking()[0]?.id).toBe("child")
      expect(background.tasks()).toEqual([])

      setStore(
        "messages",
        produce((messages) => {
          const part = messages[0].content[0]
          if (part.type !== "tool" || part.state.status !== "running") return
          part.state.metadata.sessionID = "renamed-child"
          part.state.input.description = "renamed"
        }),
      )
      expect(background.blocking()[0]).toEqual({
        type: "subagent",
        partID: "part",
        id: "renamed-child",
        label: "renamed",
      })

      setStore(
        "messages",
        produce((messages) => {
          const part = messages[0].content[0]
          if (part.type !== "tool") return
          part.state = {
            status: "completed",
            input: { description: "background child" },
            metadata: { status: "running", sessionID: "child" },
            content: [{ type: "text", text: "backgrounded" }],
          }
        }),
      )
      expect(store.messages).toBe(messages)
      expect(background.blocking()).toEqual([])
      expect(background.tasks()).toEqual([
        { id: "child", type: "subagent", label: "background child", agent: undefined },
      ])

      setStore("notifications", 0, "metadata", "source", "subagent")
      expect(background.tasks()).toEqual([])
      setStore("notifications", 0, "metadata", "childID", "other")
      expect(background.tasks()[0]?.id).toBe("child")
      setStore(
        "messages",
        produce((messages) => {
          const part = messages[0].content[0]
          if (part.type !== "tool") return
          part.state = { status: "running", input: {}, metadata: { sessionID: "child" } }
        }),
      )
      expect(background.tasks()).toEqual([])
      expect(background.blocking()[0]?.id).toBe("child")
      setStore("messages", 0, "time", "completed", 0)
      expect(background.blocking()).toEqual([])
      setStore("messages", 0, "time", "completed", undefined)
      expect(background.blocking()[0]?.id).toBe("child")
      dispose()
    })
  })

  test("clears history on a session change or when no primary session is selected", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ id: "root" as string | undefined })
      const messages: Record<string, SessionMessageInfo[]> = {
        root: [assistant("assistant", [tool("part", "shell", { status: "running" })])],
        other: [],
      }
      const background = createSessionBackground({
        sessionID: () => store.id,
        messages: (id) => messages[id],
        sessions: () => [session("child")],
        status: () => "running",
        shells: () => [shell("shell", "command")],
      })
      expect(background.tasks().map((task) => task.id)).toEqual(["child", "part", "shell"])
      setStore("id", "other")
      expect(background.tasks()).toEqual([])
      setStore("id", "root")
      expect(background.tasks().map((task) => task.id)).toEqual(["child", "part", "shell"])
      setStore("id", undefined)
      expect(background.tasks()).toEqual([])
      expect(background.blocking()).toEqual([])
      dispose()
    })
  })
})

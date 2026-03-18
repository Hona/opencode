import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { pathToFileURL } from "url"

import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function createStream() {
  const wait: Array<() => void> = []

  return {
    stream: async function* (signal?: AbortSignal) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        wait.push(resolve)
        signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    },
    close: () => {
      for (const resolve of wait.splice(0)) resolve()
    },
  }
}

function createAgent() {
  const seen: any[] = []
  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const events = createStream()
  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({
        stream: events.stream(opts?.signal),
      }),
    },
    session: {
      create: async () => ({
        data: {
          id: "ses_1",
          time: { created: new Date().toISOString() },
        },
      }),
      messages: async () => ({ data: [] }),
      prompt: async (input: any) => {
        seen.push(input)
        return { data: {} }
      },
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: {
                "big-pickle": { id: "big-pickle", name: "big-pickle" },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          {
            name: "build",
            description: "build",
            mode: "agent",
          },
        ],
      }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  return {
    agent,
    seen,
    stop: () => {
      events.close()
      ;(agent as any).eventAbort.abort()
    },
  }
}

describe("acp.agent prompt file uris", () => {
  test("parses Windows file resource links with fileURLToPath", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, seen, stop } = createAgent()
        try {
          const cwd = tmp.path
          const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

          await agent.prompt({
            sessionId,
            prompt: [{ type: "resource_link", uri: "file:///C:/Users/me/My%20Docs/hello%20world.txt" }],
          } as any)

          expect(seen[0].parts).toEqual([
            {
              type: "file",
              url: "file:///C:/Users/me/My%20Docs/hello%20world.txt",
              filename: "hello world.txt",
              mime: "text/plain",
            },
          ])
        } finally {
          stop()
        }
      },
    })
  })

  test("keeps zed resource links mapped to local file URLs on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, seen, stop } = createAgent()
        try {
          const cwd = tmp.path
          const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
          const file = "C:\\Users\\me\\My Docs\\hello world.txt"

          await agent.prompt({
            sessionId,
            prompt: [{ type: "resource_link", uri: `zed://file?path=${encodeURIComponent(file)}` }],
          } as any)

          expect(seen[0].parts).toEqual([
            {
              type: "file",
              url: pathToFileURL(file).href,
              filename: "hello world.txt",
              mime: "text/plain",
            },
          ])
        } finally {
          stop()
        }
      },
    })
  })
})

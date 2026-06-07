import type { McpStatus } from "@opencode-ai/sdk/v2/client"

type Action = () => Promise<unknown>

export async function toggleMcp(input: {
  status: McpStatus["status"]
  connect: Action
  disconnect: Action
  authenticate: Action
  refresh: Action
}) {
  await {
    connected: input.disconnect,
    needs_auth: input.authenticate,
    disabled: input.connect,
    failed: input.connect,
    needs_client_registration: input.connect,
  }[input.status]()
  await input.refresh()
}

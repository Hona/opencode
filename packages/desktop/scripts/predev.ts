import { $ } from "bun"

await $`bun run install-electron`
await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

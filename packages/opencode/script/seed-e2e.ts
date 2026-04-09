const dir = process.env.OPENCODE_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.OPENCODE_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.OPENCODE_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.OPENCODE_E2E_MODEL ?? "opencode/gpt-5-nano"
const parts = model.split("/")
const providerID = parts[0] ?? "opencode"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const time = {
  config: 60_000,
  dispose: 30_000,
  imports: 30_000,
  instance: 60_000,
  part: 30_000,
  project: 30_000,
  session: 30_000,
  tool: 30_000,
  update: 30_000,
} as const

const step = async <T>(name: string, timeout: number, fn: () => Promise<T> | T) => {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  console.error(`seed start: ${name} timeout=${timeout}ms`)
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms: seed ${name}`)), timeout)
    }),
  ])
    .then(
      (value) => {
        console.error(`seed done: ${name} (${Date.now() - start}ms)`)
        return value
      },
      (err) => {
        console.error(`seed failed: ${name} (${Date.now() - start}ms)`)
        console.error(err)
        throw err
      },
    )
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
}

const seed = async () => {
  const mod = await step("imports", time.imports, async () => {
    const { Instance } = await import("../src/project/instance")
    const { InstanceBootstrap } = await import("../src/project/bootstrap")
    const { Config } = await import("../src/config/config")
    const { Session } = await import("../src/session")
    const { MessageID, PartID } = await import("../src/session/schema")
    const { Project } = await import("../src/project/project")
    const { ModelID, ProviderID } = await import("../src/provider/schema")
    const { ToolRegistry } = await import("../src/tool/registry")
    return {
      Config,
      Instance,
      InstanceBootstrap,
      MessageID,
      ModelID,
      PartID,
      Project,
      ProviderID,
      Session,
      ToolRegistry,
    }
  })

  try {
    await step("instance", time.instance, () =>
      mod.Instance.provide({
        directory: dir,
        init: mod.InstanceBootstrap,
        fn: async () => {
          await step("config deps", time.config, () => mod.Config.waitForDependencies())
          await step("tool ids", time.tool, () => mod.ToolRegistry.ids())

          const session = await step("session", time.session, () => mod.Session.create({ title }))
          const messageID = mod.MessageID.ascending()
          const partID = mod.PartID.ascending()
          const message = {
            id: messageID,
            sessionID: session.id,
            role: "user" as const,
            time: { created: now },
            agent: "build",
            model: {
              providerID: mod.ProviderID.make(providerID),
              modelID: mod.ModelID.make(modelID),
            },
          }
          const part = {
            id: partID,
            sessionID: session.id,
            messageID,
            type: "text" as const,
            text,
            time: { start: now },
          }
          await step("message", time.update, () => mod.Session.updateMessage(message))
          await step("part", time.part, () => mod.Session.updatePart(part))
          await step("project", time.project, () =>
            mod.Project.update({ projectID: mod.Instance.project.id, name: "E2E Project" }),
          )
        },
      }),
    )
  } finally {
    await step("dispose", time.dispose, () => mod.Instance.disposeAll()).catch(() => {})
  }
}

await seed()

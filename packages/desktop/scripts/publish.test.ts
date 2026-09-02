import { expect, test } from "bun:test"
import { CLI_BINARIES } from "./utils"
import pkg from "../package.json"

const workflow = Bun.YAML.parse(
  await Bun.file(new URL("../../../.github/workflows/publish.yml", import.meta.url)).text(),
) as {
  env: Record<string, string>
  jobs: Record<
    "build-cli" | "sign-cli-macos" | "build-electron",
    {
      if?: string
      needs?: string | string[]
      strategy?: { matrix: { settings: { host: string; target: string }[] } }
      steps: {
        name?: string
        uses?: string
        if?: string
        run?: string
        with?: { name?: string; path?: string }
        env?: Record<string, string>
      }[]
    }
  >
}
const desktop = workflow.jobs["build-electron"]

test("produces the V2 CLI artifact independently of the legacy CLI and release channel", () => {
  const steps = workflow.jobs["build-cli"].steps
  const build = steps.find((step) => step.name === "Build preview CLI")
  expect(build?.run).toContain("./packages/cli/script/build.ts")
  expect(build?.if).toBeUndefined()
  const upload = steps.find((step) => step.with?.name === "opencode-preview-cli-unsigned")
  expect(upload?.uses).toStartWith("actions/upload-artifact@")
  expect(upload?.if).toBeUndefined()
  expect(upload?.with?.path).toBe("packages/cli/dist/cli-*")
})

test("downloads the same-run signing artifact for all eligible desktop channels", () => {
  const signing = workflow.jobs["sign-cli-macos"]
  expect(signing.needs).toBe("build-cli")
  expect(signing.if).toBe("github.repository == 'anomalyco/opencode'")
  expect(signing.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"))?.with?.name).toBe(
    "opencode-preview-cli-unsigned",
  )
  expect(signing.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))?.with?.name).toBe(
    "opencode-preview-cli",
  )
  expect(desktop.needs).toContain("sign-cli-macos")
  const download = desktop.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"))
  expect(download?.if).toBeUndefined()
  expect(download?.with).toEqual({ name: "opencode-preview-cli", path: "packages/cli/dist" })
})

test.each(["Prepare", "Build"])("%s receives the artifact and target even when prebuild runs twice", (name) => {
  const step = desktop.steps.find((step) => step.name === name)
  expect(step?.env?.OPENCODE_CLI_DIST).toBe("${{ github.workspace }}/packages/cli/dist")
  expect(step?.env?.OPENCODE_CLI_TARGET).toBe("${{ matrix.settings.target }}")
  expect(step?.env?.OPENCODE_VERSION).toBe("${{ needs.version.outputs.version }}")
  expect(step?.env?.OPENCODE_CHANNEL).toBe("${{ (github.ref_name == 'beta' && 'beta') || 'prod' }}")
})

test("every desktop matrix target has a matching CLI artifact", () => {
  const targets = desktop.strategy?.matrix.settings.map((item) => item.target).sort()
  expect(targets).toEqual(CLI_BINARIES.map((item) => item.target).sort())
})

test.each(["Package", "Package (no publish)"])("%s preserves the prepared channel", (name) => {
  const step = desktop.steps.find((step) => step.name === name)
  expect(step?.run).toContain("--config electron-builder.config.ts")
  expect(step?.env?.OPENCODE_CHANNEL).toBe(desktop.steps.find((step) => step.name === "Prepare")?.env?.OPENCODE_CHANNEL)
})

test("keeps v2 development routing separate from production publication", () => {
  expect(workflow.env.OPENCODE_CHANNEL).toBe("${{ (github.ref_name == 'v2' && 'dev') || '' }}")
  expect(desktop.if).toBe("github.repository == 'anomalyco/opencode' && github.ref_name != 'v2'")
})

test("runs Desktop tests in the existing CI test task and tracks the release workflow", async () => {
  expect(pkg.scripts.test).toBe("bun test --only-failures")
  const turbo = await Bun.file(new URL("../../../turbo.json", import.meta.url)).json()
  expect(turbo.tasks["@opencode-ai/desktop#test"].inputs).toContain("$TURBO_ROOT$/.github/workflows/publish.yml")
})

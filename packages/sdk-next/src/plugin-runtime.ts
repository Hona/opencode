import "./plugin-runtime.promise"
import "./plugin-runtime.effect"

import module from "node:module"

const key = Symbol.for("opencode.sdk-next.plugin-runtime")
const globals = globalThis as typeof globalThis & Record<symbol, unknown>

if (!globals[key]) {
  globals[key] = true
  const promiseModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const Agent = sdk.Agent
export const Command = sdk.Command
export const Connection = sdk.Connection
export const Credential = sdk.Credential
export const Integration = sdk.Integration
export const Model = sdk.Model
export const Plugin = sdk.Plugin
export const Provider = sdk.Provider
export const Reference = sdk.Reference
export const Skill = sdk.Skill`
  const effectModule = promiseModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const promisePluginModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const define = sdk.Plugin.define`
  const effectPluginModule = promisePluginModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const promiseToolModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const Tool = sdk.Tool
export const make = sdk.Tool.make`
  const effectToolModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.effect")]
if (!sdk) throw new Error("OpenCode Effect plugin SDK is unavailable")
export const Tool = sdk.Tool
export const Failure = sdk.Tool.Failure
export const RegistrationError = sdk.Tool.RegistrationError
export const make = sdk.Tool.make
export const validateName = sdk.Tool.validateName
export const registrationEntries = sdk.Tool.registrationEntries
export const validateNamespace = sdk.Tool.validateNamespace
export const toLLMDefinition = sdk.Tool.toLLMDefinition`
  const modules: Record<string, string> = {
    "@opencode-ai/plugin/v2": "opencode:plugin-v2",
    "@opencode-ai/plugin/v2/plugin": "opencode:plugin-v2-plugin",
    "@opencode-ai/plugin/v2/tool": "opencode:plugin-v2-tool",
    "@opencode-ai/plugin/v2/effect": "opencode:plugin-v2-effect",
    "@opencode-ai/plugin/v2/effect/plugin": "opencode:plugin-v2-effect-plugin",
    "@opencode-ai/plugin/v2/effect/tool": "opencode:plugin-v2-effect-tool",
  }
  const sources: Record<string, string> = {
    "opencode:plugin-v2": promiseModule,
    "opencode:plugin-v2-plugin": promisePluginModule,
    "opencode:plugin-v2-tool": promiseToolModule,
    "opencode:plugin-v2-effect": effectModule,
    "opencode:plugin-v2-effect-plugin": effectPluginModule,
    "opencode:plugin-v2-effect-tool": effectToolModule,
  }
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = modules[specifier]
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      const source = sources[url]
      return source ? { format: "module", source, shortCircuit: true } : nextLoad(url, context)
    },
  })
}

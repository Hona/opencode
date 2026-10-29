import { Context, Effect, Layer } from "effect"
import { Info, Ref, response } from "@opencode/schema/location"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Project } from "./project.js"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode/util/effect/app-node"

export * as Location from "./location.js"

export { Info, Ref, response }

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
  // The global scope: requests tied to no project, rooted at the global config directory.
  readonly global?: boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

export const node = LayerNode.unbound(Service, tags.values.location)

const layer = (ref: Ref) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      // The global scope belongs to no project: it records no Project and runs no VCS discovery.
      if (ref.workspaceID === undefined && (yield* fs.resolve(ref.directory)) === (yield* fs.resolve(global.config)))
        return Service.of({
          directory: ref.directory,
          project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
          global: true,
        })
      const project = yield* Project.Service
      const resolved = yield* project.resolve(ref.directory)
      return Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory, canonical: resolved.canonical },
        vcs: resolved.vcs,
      })
    }),
  )

export const boundNode = (ref: Ref) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref),
    deps: [Project.node, FSUtil.node, Global.node],
  })

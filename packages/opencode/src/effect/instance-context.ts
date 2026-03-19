import { ServiceMap } from "effect"
import type { PrettyPath } from "@/path/schema"
import type { Project } from "@/project/project"

export declare namespace InstanceContext {
  export interface Shape {
    readonly directory: PrettyPath
    readonly worktree: PrettyPath
    readonly project: Project.Info
  }
}

export class InstanceContext extends ServiceMap.Service<InstanceContext, InstanceContext.Shape>()(
  "opencode/InstanceContext",
) {}

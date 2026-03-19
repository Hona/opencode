import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zodFrom } from "@/util/schema"
import { Newtype } from "@/util/schema"

export class PermissionID extends Newtype<PermissionID>()("PermissionID", Schema.String) {
  static make(id: string): PermissionID {
    return this.makeUnsafe(id)
  }

  static parse(id: string): PermissionID {
    return this.makeUnsafe(Identifier.parse("permission", id))
  }

  static assert(id: string) {
    Identifier.assert("permission", id)
  }

  static ascending(id?: string): PermissionID {
    return this.makeUnsafe(Identifier.ascending("permission", id))
  }

  static readonly zod = zodFrom((id) => this.parse(id))
}

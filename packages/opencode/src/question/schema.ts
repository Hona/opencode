import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zodFrom } from "@/util/schema"
import { Newtype } from "@/util/schema"

export class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
  static make(id: string): QuestionID {
    return this.makeUnsafe(id)
  }

  static parse(id: string): QuestionID {
    return this.makeUnsafe(Identifier.parse("question", id))
  }

  static assert(id: string) {
    Identifier.assert("question", id)
  }

  static ascending(id?: string): QuestionID {
    return this.makeUnsafe(Identifier.ascending("question", id))
  }

  static readonly zod = zodFrom((id) => this.parse(id))
}

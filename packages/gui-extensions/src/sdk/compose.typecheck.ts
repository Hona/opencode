// Type-level contract of typed composition, checked by `bun typecheck`. Nothing imports this file. Each
// `@ts-expect-error` fails the typecheck if its line stops being an error.
import type { Accessor } from "solid-js"
import { Schema } from "effect"
import {
  Extension,
  Remote,
  Service,
  Store,
  type Composition,
  type Duplicate,
  type Live,
  type Missing,
  type MissingMain,
  type RemotesProvided,
  type Setup,
} from "./index"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const equal = <A, B>(value: Equal<A, B>) => value

const Tree = Service.define<{ open(path: string): void }, "fixture.tree">("fixture.tree")

const Changes = Service.define<{ count(): number }, "fixture.changes">("fixture.changes")

const Unlisted = Service.define<{ ping(): void }, "fixture.unlisted">("fixture.unlisted")

const Pane = Remote.define({ id: "fixture.pane", methods: { open: { input: Schema.String } } })

const View = Schema.Struct({ open: Schema.Boolean })

const TreeProvider = Extension.define({ id: "tree", provides: { tree: Tree } })

const PaneProvider = Extension.define({ id: "pane", provides: { pane: Pane } })

const Consumer = Extension.define({
  id: "consumer",
  uses: { changes: Changes },
  requires: { tree: Tree, pane: Pane },
  stores: { view: Store.app(View, { open: false }), draft: Store.session(View, { open: true }) },
})

// A composition with every hard provider and no duplicate compiles, and is the identity at runtime.
export const renderer = Extension.compose(TreeProvider, PaneProvider, Consumer)

equal<typeof renderer, readonly [typeof TreeProvider, typeof PaneProvider, typeof Consumer]>(true)

// A `requires` token nobody provides.
// @ts-expect-error the composition is missing a provider of fixture.tree
Extension.compose(PaneProvider, Consumer)

equal<Composition<[typeof PaneProvider, typeof Consumer]>, { readonly "missing provider": Missing<"fixture.tree"> }>(
  true,
)

// Two providers of one token.
const Second = Extension.define({ id: "second", provides: { tree: Tree } })

// @ts-expect-error two extensions provide fixture.tree
Extension.compose(TreeProvider, Second, PaneProvider, Consumer)

equal<
  Composition<[typeof TreeProvider, typeof Second, typeof PaneProvider, typeof Consumer]>,
  { readonly "duplicate provider": Duplicate<"fixture.tree"> }
>(true)

// A renderer Remote needs an entry with a main module that provides it in the main composition.
export const main = Extension.compose({ ...PaneProvider, main: async () => ({ default: () => undefined }) })

export const remotes: RemotesProvided<typeof renderer, typeof main> = true

export const mainless = Extension.compose(PaneProvider)

// @ts-expect-error no main entry provides fixture.pane
export const unprovided: RemotesProvided<typeof renderer, typeof mainless> = true

equal<RemotesProvided<typeof renderer, typeof mainless>, MissingMain<"fixture.pane">>(true)

// The typed context exposes only what the definition declares.
export const setup: Setup<typeof Consumer> = (ctx) => {
  equal<typeof ctx.uses.changes, Accessor<Live<{ count(): number }>>>(true)
  const changes = ctx.use(Changes)
  equal<typeof changes, Accessor<Live<{ count(): number }>>>(true)
  ctx.requires.tree.open("a.ts")
  void ctx.requires.pane.open("https://example.com")
  equal<typeof ctx.stores.view.value, { readonly open: boolean }>(true)
  equal<ReturnType<typeof ctx.stores.draft>["value"], { readonly open: boolean } | undefined>(true)
  // @ts-expect-error fixture.unlisted is not declared in uses
  ctx.use(Unlisted)
  // @ts-expect-error fixture.tree is required, not used: its value is `ctx.requires.tree`
  ctx.use(Tree)
  // @ts-expect-error the consumer declares no provides
  ctx.provide(Tree, { open: () => undefined })
  // @ts-expect-error no store named missing
  void ctx.stores.missing
}

export const provider: Setup<typeof TreeProvider> = (ctx) => {
  ctx.provide(Tree, { open: () => undefined })
  // @ts-expect-error the implementation must match the token
  ctx.provide(Tree, { close: () => undefined })
}

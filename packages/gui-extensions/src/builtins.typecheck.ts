// Type-level check of the built-in compositions, run by `bun typecheck`. Nothing imports this file. Every Remote a
// renderer entry declares in `uses` or `requires` needs a main entry that provides it: an unprovided `uses` stays
// pending forever, and an unprovided `requires` would also hold the window's startup gate. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.
import { Extension, Remote, type MissingMain, type RemotesProvided } from "./sdk"
import type { builtins } from "./renderer"
// Both compositions export `builtins`, and this file names the two together.
import type { builtins as mainBuiltins } from "./main"
import type browser from "./browser"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const equal = <A, B>(value: Equal<A, B>) => value

export const remotes: RemotesProvided<typeof builtins, typeof mainBuiltins> = true

// The main composition with the browser's definition but not its main entry, which provides the pane.
type Mainless = readonly (Exclude<(typeof mainBuiltins)[number], { readonly id: "browser" }> | typeof browser)[]

// @ts-expect-error no main entry provides browser.pane, which the browser's renderer uses
export const mainless: RemotesProvided<typeof builtins, Mainless> = true

equal<RemotesProvided<typeof builtins, Mainless>, MissingMain<"browser.pane">>(true)

const Orphan = Remote.define({ id: "fixture.orphan", methods: {} })

// A renderer that uses a remote nothing in main provides.
const Uses = Extension.define({ id: "fixture", uses: { orphan: Orphan } })

// @ts-expect-error no main entry provides fixture.orphan
export const used: RemotesProvided<readonly [...typeof builtins, typeof Uses], typeof mainBuiltins> = true

// A renderer that requires it, from an extension listed in main without the main entry that would provide it.
const Provider = Extension.define({ id: "fixture.provider", provides: { orphan: Orphan } })

const Requires = Extension.define({ id: "fixture.requires", requires: { orphan: Orphan } })

// @ts-expect-error a renderer `requires` with no main provider would hold the startup gate
export const held: RemotesProvided<
  readonly [...typeof builtins, typeof Provider, typeof Requires],
  readonly [...typeof mainBuiltins, typeof Provider]
> = true

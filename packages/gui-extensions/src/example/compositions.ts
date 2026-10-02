import { Extension, type IpcsProvided } from "../sdk"
import example from "./index"
import setup from "./renderer"

/** The window composition, as `src/renderer.ts` lists the built-ins. */
export const renderer = Extension.compose({ ...example, renderer: async () => ({ default: setup }) })

/** The main composition, as `src/main.ts` lists the built-ins. */
export const main = Extension.compose({ ...example, main: () => import("./main") })

// The window uses `example.counter`, so a main entry must provide it: without `main` above, this fails to compile.
export const ipcs: IpcsProvided<typeof renderer, typeof main> = true

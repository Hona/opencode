declare module "node:ffi" {
  export function dlopen(
    path: string,
    definitions: Readonly<Record<string, { readonly arguments?: readonly string[]; readonly return?: string }>>,
  ): {
    readonly lib: { close(): void }
    readonly functions: Readonly<Record<string, (...args: ReadonlyArray<unknown>) => number | bigint>>
  }
}

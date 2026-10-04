import { fileURLToPath } from "node:url"

/**
 * A canonical Vite filesystem URL for a module imported by a component test. Strip the POSIX root slash after
 * Vite's `/@fs/` prefix so imports and app aliases share one module, including context-provider singletons.
 *
 * @param path - The module path relative to the test.
 * @param base - The test's `import.meta.url`.
 */
export function source(path: string, base: string) {
  return `/@fs/${fileURLToPath(new URL(path, base)).replaceAll("\\", "/").replace(/^\/+/, "")}`
}

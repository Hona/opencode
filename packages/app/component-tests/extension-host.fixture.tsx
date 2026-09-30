import { DialogProvider } from "@opencode/ui/context/dialog"
import type { Setup } from "@opencode/gui-extensions/sdk"
import { render } from "solid-js/web"
import { ExtensionHostProvider, useExtensionHost } from "../src/runtime/extension/host"
import { LanguageProvider } from "../src/runtime/i18n/language"

/** Mounts the real extension host with one extension whose renderer entry resolves when the test says so. */
export function mountExtensionHost() {
  const entry = Promise.withResolvers<{ default: Setup }>()
  const disabled = new Set<string>()
  const state = { host: undefined as ReturnType<typeof useExtensionHost> | undefined }
  const host = document.createElement("div")
  document.body.appendChild(host)
  function Capture() {
    state.host = useExtensionHost()
    return null
  }
  const unmount = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <ExtensionHostProvider
            definitions={[{ id: "fixture", renderer: () => entry.promise }]}
            disabled={() => disabled}
            services={[]}
          >
            <Capture />
          </ExtensionHostProvider>
        </DialogProvider>
      </LanguageProvider>
    ),
    host,
  )
  return {
    unmount,
    load: (setup: Setup) => entry.resolve({ default: setup }),
    /** Contributions the host holds for a point; readable after the host unmounts. */
    entries: (point: string) => state.host?.state.entries[point]?.length ?? 0,
  }
}

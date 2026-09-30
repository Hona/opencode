import { DialogProvider } from "@opencode/ui/context/dialog"
import type { Setup } from "@opencode/gui-extensions/sdk"
import { render } from "solid-js/web"
import { ExtensionHostProvider } from "../src/runtime/extension/host"
import { LanguageProvider } from "../src/runtime/i18n/language"

/** Mounts the real extension host with one extension whose renderer entry resolves when the test says so. */
export function mountExtensionHost() {
  const entry = Promise.withResolvers<{ default: Setup }>()
  const disabled = new Set<string>()
  const state = { setups: 0 }
  const host = document.createElement("div")
  document.body.appendChild(host)
  const unmount = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <ExtensionHostProvider
            definitions={[{ id: "fixture", renderer: () => entry.promise }]}
            disabled={() => disabled}
            services={[]}
          />
        </DialogProvider>
      </LanguageProvider>
    ),
    host,
  )
  return {
    unmount,
    load: () => entry.resolve({ default: () => void state.setups++ }),
    setups: () => state.setups,
  }
}

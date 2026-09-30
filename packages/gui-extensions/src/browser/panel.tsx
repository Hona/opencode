import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, For, on, onCleanup, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { App, Surfaces, useExtension, usePanel, type PanelTab, type SessionView } from "../sdk"
import type { Model } from "./model"

export default function SessionBrowserPane(props: { tab: Accessor<PanelTab>; session: SessionView; model: Model }) {
  const extension = useExtension()
  const app = extension.use(App)
  const surfaces = extension.use(Surfaces)
  const panel = usePanel()
  const visible = () => panel.visible()
  const state = () => props.model.tab(props.session, props.tab().id)
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const suspended = () => props.model.suspended(props.session)
  const command = (action: Browser.Action) => props.model.command(props.session, action)
  const button = { variant: "ghost", size: "large" } as const
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    submitted: false,
    // A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile.
    navigating: false,
  })
  const empty = () => !address() && !state()?.loading && !store.navigating
  // The desktop page hides blank and loading documents itself; only hide here
  // while the pane shows its own empty or failed state over the surface.
  const shown = () => visible() && !empty() && !failed()
  const surface = () => {
    const tab = state()
    return tab ? props.model.surface(props.session, tab.id) : undefined
  }
  let addressDisplay: HTMLDivElement | undefined
  const scheme = () => store.address.match(/^https?:\/\//i)?.[0] ?? ""
  const error = () => {
    const value = props.model.error(props.session)
    if (value === "browser.pane.replaced") return extension.t("replaced")
    if (value === "browser.pane.unsupported") return extension.t("unsupported")
    return value
  }

  onCleanup(
    props.model.mount({
      visible,
      address,
      reload: () => {
        const tab = state()
        if (tab) command({ type: "reload", tabID: tab.id })
      },
    }),
  )

  // A restored tab has no page until the pane first shows it.
  createEffect(() => {
    const tab = state()
    if (!tab || !shown() || surface()) return
    props.model.load(props.session, tab.id)
  })
  createEffect(on([() => state()?.id, address], () => !store.editing && setStore("address", address())))
  // Any reported movement, including a rejected or blocked request, ends the submitted navigation.
  createEffect(
    on(
      [() => state()?.id, () => state()?.generation, () => state()?.loading, () => props.model.error(props.session)],
      () => setStore("navigating", false),
      { defer: true },
    ),
  )
  // A blocked or rejected submission leaves the page where it was; show that page's URL again.
  createEffect(
    on(
      () => props.model.error(props.session),
      (error) => {
        if (error && !store.editing) setStore("address", address())
      },
      { defer: true },
    ),
  )

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div class="h-10 shrink-0 flex items-center gap-1 px-3 border-b border-v2-border-border-muted">
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <Tooltip placement="top" value={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}>
              <IconButton
                {...button}
                disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                aria-label={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}
                onClick={() => {
                  const tab = state()
                  if (tab) command({ type: direction, tabID: tab.id })
                }}
                icon={
                  <Icon
                    name={direction === "back" ? "chevron-left" : "chevron-right"}
                    size="small"
                    class="rtl:rotate-180"
                  />
                }
              />
            </Tooltip>
          )}
        </For>
        <Tooltip
          placement="top"
          value={
            <div class="flex items-center gap-2">
              <span>{extension.t(state()?.loading ? "action.stop" : "error.page.action.reload")}</span>
              <Show when={!state()?.loading}>
                <Keybind keys={[...app.keybind("browser.reload")]} variant="neutral" />
              </Show>
            </div>
          }
        >
          <IconButton
            {...button}
            disabled={!state()?.loading && !address()}
            aria-label={extension.t(state()?.loading ? "action.stop" : "error.page.action.reload")}
            onClick={() => {
              const tab = state()
              if (tab) command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
            }}
            icon={
              <Show when={state()?.loading} fallback={<Icon name="refresh" size="small" />}>
                <Loader />
              </Show>
            }
          />
        </Tooltip>
        <form
          dir="ltr"
          class="relative min-w-0 flex-1 h-7 rounded-md hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover text-12-regular"
          onSubmit={(event) => {
            event.preventDefault()
            const tab = state()
            const url = store.address.trim()
            if (!tab) return
            if (url || failed()) {
              setStore({ submitted: true, address: url, navigating: true })
              command({ type: "navigate", tabID: tab.id, url: url || "about:blank" })
            }
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            class="w-full h-full px-2 rounded-md border border-transparent bg-transparent text-transparent caret-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
            spellcheck={false}
            autocomplete="off"
            value={store.address}
            disabled={!state()}
            placeholder={extension.t("address.placeholder")}
            aria-label={extension.t("address.label")}
            onFocus={(event) => {
              setStore("editing", true)
              event.currentTarget.select()
            }}
            onClick={(event) => event.currentTarget.select()}
            onBlur={() =>
              setStore({ editing: false, address: store.submitted ? store.address : address(), submitted: false })
            }
            onInput={(event) => setStore("address", event.currentTarget.value)}
            onScroll={(event) => {
              if (addressDisplay) addressDisplay.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
          {/* Keep native input editing and selection while coloring the scheme, including during editing. */}
          <div
            aria-hidden="true"
            class="absolute inset-0 flex items-center px-2 border border-transparent pointer-events-none"
          >
            <div ref={addressDisplay} class="w-full overflow-hidden whitespace-pre text-v2-text-text-base">
              <span class="text-v2-text-text-muted">{scheme()}</span>
              {store.address.slice(scheme().length)}
            </div>
          </div>
        </form>
      </div>
      <Show when={error() && !failed()}>
        <div
          class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger-base border-b border-v2-border-border-muted"
          role="alert"
          aria-live="assertive"
        >
          {error()}
        </div>
      </Show>
      <surfaces.View
        id={surface()}
        visible={shown()}
        radius={10}
        class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center"
      >
        <Show when={(empty() || failed()) && !suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {extension.t(failed() ? "failed.title" : "empty.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">
              {extension.t(failed() ? "failed.description" : "empty.description")}
            </div>
          </div>
        </Show>
        <Show when={suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {extension.t("suspended")}
          </p>
        </Show>
      </surfaces.View>
    </aside>
  )
}

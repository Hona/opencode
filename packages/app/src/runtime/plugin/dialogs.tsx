import { createSignal, For, Show } from "solid-js"
import type { AlertOptions, ConfirmOptions, PromptOptions, SelectOptions } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useFilteredList } from "@opencode/ui/hooks"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import "@/shell/search-list.css"

// The dialogs behind `Dialogs.confirm`, `alert`, `prompt` and `select`. Each answers through `done`; the host closes
// the dialog and settles the plugin's promise.

export function PluginConfirmDialog(props: { options: ConfirmOptions; done: (confirmed: boolean) => void }) {
  const language = useLanguage()

  // A destructive action starts on Cancel, as the app's delete dialogs do; any other confirms with Enter.
  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.message} />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus={!!props.options.destructive} onClick={() => props.done(false)}>
          {props.options.cancel ?? language.t("common.cancel")}
        </Button>
        <Button
          variant={props.options.destructive ? "danger" : "contrast"}
          autofocus={!props.options.destructive}
          onClick={() => props.done(true)}
        >
          {props.options.confirm ?? language.t("ui.common.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function PluginAlertDialog(props: { options: AlertOptions; done: () => void }) {
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.message} />
      </DialogHeader>
      <DialogFooter>
        <Button variant="contrast" autofocus onClick={() => props.done()}>
          {props.options.ok ?? language.t("common.ok")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function PluginPromptDialog(props: { options: PromptOptions; done: (value: string | undefined) => void }) {
  const language = useLanguage()
  const field = { value: props.options.value ?? "", selected: false }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={props.options.title} description={props.options.message} />
      </DialogHeader>
      <DialogBody class="px-4">
        <TextInput
          type="text"
          appearance="large"
          class="!w-full"
          value={field.value}
          placeholder={props.options.placeholder}
          aria-label={props.options.title}
          autofocus
          spellcheck={false}
          autocomplete="off"
          // The starting text is selected once, so typing replaces it.
          onFocus={(event) => {
            if (field.selected) return
            field.selected = true
            event.currentTarget.select()
          }}
          onInput={(event) => {
            field.value = event.currentTarget.value
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            props.done(field.value)
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.done(undefined)}>
          {props.options.cancel ?? language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => props.done(field.value)}>
          {props.options.confirm ?? language.t("ui.common.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function PluginSelectDialog<T extends string>(props: { options: SelectOptions<T>; done: (value: T) => void }) {
  const language = useLanguage()

  const list = useFilteredList({
    items: [...props.options.options],
    key: (option) => option.value,
    filterKeys: ["label", "description"],
    onSelect: (option) => {
      if (option) props.done(option.value)
    },
  })

  const [results, setResults] = createSignal<HTMLDivElement>()

  const onKeyDown = (event: KeyboardEvent) => {
    // The pointer leaving the rows clears the highlight, so Enter then picks the first match.
    if (event.key === "Enter" && !event.isComposing && !list.active()) {
      event.preventDefault()
      const first = list.flat()[0]

      if (first) props.done(first.value)

      return
    }

    list.onKeyDown(event)
    const active = list.active()

    if (!active) return
    results()
      ?.querySelector(`[data-option-key="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }

  return (
    <Dialog class="search-list-dialog">
      <DialogHeader>
        <DialogTitleGroup title={props.options.title} />
      </DialogHeader>
      <DialogBody class="search-list-body">
        <div class="search-list-search">
          <TextInput
            type="search"
            appearance="base"
            class="!w-full"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={language.t("common.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            autofocus
            aria-label={language.t("common.search.placeholder")}
            showClearButton={!!list.filter()}
            clearIcon="circle-xmark"
            clearLabel={language.t("common.clear")}
            onClearClick={() => list.clear()}
          />
        </div>
        <div class="search-list-scroll" data-scrollable ref={setResults}>
          <Show
            when={list.flat().length > 0}
            fallback={<div class="search-list-empty">{language.t("ui.list.empty")}</div>}
          >
            <div role="listbox" aria-label={props.options.title} class="search-list-results">
              <For each={list.flat()}>
                {(option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={list.active() === option.value}
                    data-option-key={option.value}
                    data-active={list.active() === option.value ? "" : undefined}
                    class="search-list-row"
                    onMouseMove={() => list.setActive(() => option.value)}
                    onMouseLeave={() => list.setActive("")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => props.done(option.value)}
                  >
                    <span class="search-list-row-text">
                      <span class="search-list-title">{option.label}</span>
                      <Show when={option.description}>
                        {(description) => <span class="search-list-detail">{description()}</span>}
                      </Show>
                    </span>
                    <Show when={option.value === props.options.value}>
                      <span class="search-list-trailing">
                        <Icon name="check" size="small" />
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

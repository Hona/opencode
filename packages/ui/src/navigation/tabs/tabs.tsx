import { Content, List, Root, Trigger } from "@kobalte/core/tabs"
import { Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps, Component } from "solid-js"
import { useI18n } from "../../context/i18n"
import "./tabs.css"

export interface TabsProps extends ComponentProps<typeof Root> {
  variant?: "normal" | "pill" | "settings"
  orientation?: "horizontal" | "vertical"
}
export interface TabsListProps extends ComponentProps<typeof List> {}
export interface TabsTriggerProps extends ComponentProps<typeof Trigger> {
  onMiddleClick?: () => void
  /** Optional subtext shown beside the primary content (muted style) */
  subtext?: JSX.Element | string
}
export interface TabsCloseButtonProps extends ComponentProps<"div"> {}
export interface TabsContentProps extends ComponentProps<typeof Content> {}

function TabsRoot(props: TabsProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "variant", "orientation"])
  return (
    <Root
      {...rest}
      orientation={split.orientation}
      data-component="tabs-v2"
      data-variant={split.variant || "normal"}
      data-orientation={split.orientation || "horizontal"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function TabsList(props: TabsListProps) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <List
      {...rest}
      data-slot="tabs-v2-list"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function TabsTrigger(props: ParentProps<TabsTriggerProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children", "onMiddleClick", "subtext"])
  return (
    <div
      data-slot="tabs-v2-trigger-wrapper"
      data-value={props.value}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      onMouseDown={(e) => {
        if (e.button === 1 && split.onMiddleClick) {
          e.preventDefault()
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && split.onMiddleClick) {
          e.preventDefault()
          split.onMiddleClick()
        }
      }}
    >
      <Trigger {...rest} dir="auto" data-slot="tabs-v2-trigger" data-value={props.value}>
        <span class="inline-flex items-center gap-2" data-slot="tabs-v2-trigger-content">
          {split.children}
          <Show when={split.subtext}>
            {(subtext) => (
              <span data-slot="tabs-v2-subtext" class="ms-2 text-xs text-text-weak">
                {subtext()}
              </span>
            )}
          </Show>
        </span>
      </Trigger>
    </div>
  )
}

function TabsCloseButton(props: TabsCloseButtonProps) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, ["class", "classList", "onClick", "onKeyDown"])
  return (
    <div
      role="button"
      tabindex={0}
      aria-label={i18n.t("ui.tabs.close")}
      data-slot="tabs-v2-close-button"
      {...rest}
      classList={{
        [local.class ?? ""]: !!local.class,
        ...local.classList,
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (typeof local.onClick === "function") {
          local.onClick(e)
        }
      }}
      onKeyDown={(event) => {
        if (typeof local.onKeyDown === "function") local.onKeyDown(event)
        if (event.defaultPrevented) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.currentTarget.click()
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.8889 3.11108L3.11108 10.8889" stroke="currentColor" stroke-linejoin="round" />
        <path d="M3.11108 3.11108L10.8889 10.8889" stroke="currentColor" stroke-linejoin="round" />
      </svg>
    </div>
  )
}

function TabsContent(props: ParentProps<TabsContentProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Content
      {...rest}
      data-slot="tabs-v2-content"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Content>
  )
}

const TabsSectionTitle: Component<ParentProps> = (props) => {
  return <div data-slot="tabs-v2-section-title">{props.children}</div>
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  CloseButton: TabsCloseButton,
  Content: TabsContent,
  SectionTitle: TabsSectionTitle,
})

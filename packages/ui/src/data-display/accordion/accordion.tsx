import { Content, Header, Item, Root, Trigger } from "@kobalte/core/accordion"
import { Show, splitProps, type Component, type ComponentProps, type ParentProps } from "solid-js"
import "./accordion.css"

const ChevronDown: Component = () => (
  <svg
    data-slot="accordion-v2-chevron"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" />
  </svg>
)

export interface AccordionProps extends ComponentProps<typeof Root> {}
export interface AccordionItemProps extends ComponentProps<typeof Item> {}
export interface AccordionHeaderProps extends ComponentProps<typeof Header> {}
export interface AccordionTriggerProps extends ComponentProps<typeof Trigger> {
  hideChevron?: boolean
}
export interface AccordionContentProps extends ComponentProps<typeof Content> {}

function AccordionRoot(props: ParentProps<AccordionProps>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return <Root {...r} data-component="accordion-v2" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }} />
}

function AccordionItem(props: ParentProps<AccordionItemProps>) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return <Item {...r} data-component="accordion-v2-item" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }} />
}

function AccordionHeader(props: ParentProps<AccordionHeaderProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children"])
  return (
    <Header {...r} data-slot="accordion-v2-header" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}>
      {s.children}
    </Header>
  )
}

function AccordionTrigger(props: ParentProps<AccordionTriggerProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children", "hideChevron"])
  return (
    <Trigger {...r} data-component="accordion-v2-trigger" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}>
      <span data-slot="accordion-v2-trigger-content">{s.children}</span>
      <Show when={!s.hideChevron}>
        <ChevronDown />
      </Show>
    </Trigger>
  )
}

function AccordionContent(props: ParentProps<AccordionContentProps>) {
  const [s, r] = splitProps(props, ["class", "classList", "children"])
  return (
    <Content {...r} data-component="accordion-v2-content" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}>
      <div data-slot="accordion-v2-content-inner">{s.children}</div>
    </Content>
  )
}

export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
})

import { createUniqueId, splitProps, type ComponentProps } from "solid-js"
import "./session-progress-indicator-v2.css"

const frames = new URL("./session-progress-indicator-v2-3x.png", import.meta.url).href

export function SessionProgressIndicatorV2(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])
  const filter = `session-progress-indicator-${createUniqueId()}`
  return (
    <svg
      {...rest}
      class={local.class}
      classList={local.classList}
      width={local.width ?? 16}
      height={local.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-component="session-progress-indicator-v2"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <defs>
        <filter id={filter} filterUnits="userSpaceOnUse" x={0} y={0} width={16} height={16}>
          <feFlood flood-color="currentColor" result="color" />
          <feComposite in="color" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      <image data-frame-content href={frames} x={0} y={0} width={16} height={16} filter={`url(#${filter})`} />
      <rect data-reduced-motion x={7.5} y={7.5} width={2} height={2} />
    </svg>
  )
}

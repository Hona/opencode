import { createUniqueId, splitProps, type ComponentProps } from "solid-js"
import "./session-progress-indicator-v2.css"

const frames = new URL("./session-progress-indicator-v2-3x.png", import.meta.url).href

export function SessionProgressIndicatorV2(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])
  const mask = `session-progress-indicator-${createUniqueId()}`
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
        <mask id={mask} data-frame-mask maskUnits="userSpaceOnUse" x={0} y={0} width={16} height={16}>
          <image href={frames} x={0} y={0} width={16} height={16} />
        </mask>
      </defs>
      <rect data-frame-content x={0} y={0} width={16} height={16} fill="currentColor" mask={`url(#${mask})`} />
      <rect data-reduced-motion x={7.5} y={7.5} width={2} height={2} />
    </svg>
  )
}

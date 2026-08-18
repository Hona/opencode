import { type ComponentProps, splitProps } from "solid-js"
import "./badge.css"

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: "neutral" | "accent"
}

export function Badge(props: BadgeProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "children", "variant"])
  return (
    <span
      {...rest}
      data-component="tag"
      data-variant={split.variant ?? "neutral"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </span>
  )
}

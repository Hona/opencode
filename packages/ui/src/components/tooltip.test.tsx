import { expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { TooltipV2 } from "../v2/components/tooltip-v2"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function expectDescribed(trigger: HTMLElement, described: boolean) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (trigger.hasAttribute("aria-describedby") === described) return
    await tick()
  }
  expect(trigger.hasAttribute("aria-describedby")).toBe(described)
}

test("reactivated TooltipV2 blocks its tooltip while a child popup is expanded", async () => {
  const container = document.createElement("div")
  const button = document.createElement("button")
  button.textContent = "Trigger"
  document.body.append(container)
  const [inactive, setInactive] = createSignal(false)
  const dispose = render(
    () =>
      createComponent(TooltipV2, {
        value: "Help",
        openDelay: 0,
        get inactive() {
          return inactive()
        },
        children: button,
      }),
    container,
  )

  try {
    const initial = container.querySelector<HTMLElement>('[data-component="tooltip-v2-trigger"]')
    expect(initial).not.toBeNull()
    initial!.dispatchEvent(new PointerEvent("pointerenter"))
    await expectDescribed(initial!, true)
    initial!.click()
    await expectDescribed(initial!, false)
    setInactive(true)
    expect(container.querySelector('[data-component="tooltip-v2-trigger"]')).toBeNull()
    setInactive(false)
    await tick()

    const trigger = container.querySelector<HTMLElement>('[data-component="tooltip-v2-trigger"]')
    expect(trigger).not.toBeNull()
    button.setAttribute("aria-expanded", "true")
    await tick()
    trigger?.dispatchEvent(new PointerEvent("pointerenter"))
    await expectDescribed(trigger!, false)
  } finally {
    dispose()
    container.remove()
  }
})

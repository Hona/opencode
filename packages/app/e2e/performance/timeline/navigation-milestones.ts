import type { Page } from "@playwright/test"

export type NavigationMilestoneSample = {
  observedAtMs: number
  milestones: Record<string, boolean>
}

export function summarizeNavigationMilestones(samples: NavigationMilestoneSample[]) {
  const names = Object.keys(samples[0]?.milestones ?? {})
  const summarize = (matches: (sample: NavigationMilestoneSample) => boolean) => {
    const first = samples.find(matches)
    const stable = samples.findIndex(
      (sample, index) =>
        index + 2 < samples.length && matches(sample) && matches(samples[index + 1]!) && matches(samples[index + 2]!),
    )
    return {
      firstObservedMs: first?.observedAtMs ?? null,
      stableObservedMs: stable === -1 ? null : samples[stable + 2]!.observedAtMs,
    }
  }
  return {
    samples: samples.length,
    milestones: Object.fromEntries(names.map((name) => [name, summarize((sample) => sample.milestones[name] === true)])),
    all: summarize((sample) => names.every((name) => sample.milestones[name] === true)),
  }
}

type NavigationMilestoneProbe = {
  samples: NavigationMilestoneSample[]
  stop: () => void
}

export async function measureNavigationMilestones(
  page: Page,
  input: {
    triggerSelector: string
    milestones: Record<string, { selector: string; visible?: boolean }>
    navigate: () => Promise<void>
  },
) {
  await page.evaluate(({ triggerSelector, milestones }) => {
    const samples: NavigationMilestoneSample[] = []
    let started: number | undefined
    let running = true
    const visible = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].some((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })
    const sample = () => {
      if (!running || started === undefined) return
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!running || started === undefined) return
          samples.push({
            observedAtMs: performance.now() - started,
            milestones: Object.fromEntries(
              Object.entries(milestones).map(([name, milestone]) => [
                name,
                milestone.visible === false ? !document.querySelector(milestone.selector) : visible(milestone.selector),
              ]),
            ),
          })
          sample()
        }, 0)
      })
    }
    document.addEventListener(
      "click",
      (event) => {
        if (!(event.target instanceof Element) || !event.target.closest(triggerSelector)) return
        started = performance.now()
        sample()
      },
      { capture: true, once: true },
    )
    ;(window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones = {
      samples,
      stop: () => {
        running = false
      },
    }
  }, { triggerSelector: input.triggerSelector, milestones: input.milestones })
  await input.navigate()
  await page.waitForFunction(() => {
    const samples = (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones
      ?.samples
    if (!samples || samples.length < 3) return false
    return samples.slice(-3).every((sample) => Object.values(sample.milestones).every(Boolean))
  })
  const samples = await page.evaluate(() => {
    const probe = (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones!
    probe.stop()
    return probe.samples
  })
  return { summary: summarizeNavigationMilestones(samples), samples }
}

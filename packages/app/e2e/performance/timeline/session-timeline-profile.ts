import type { CDPSession, Page } from "@playwright/test"

type TimelineProfile = {
  cdp: CDPSession
  cpuThrottle: number
  profileCPU: boolean
}

export async function startTimelineProfile(
  page: Page,
  options: { cpuThrottle: number; profileCPU: boolean },
): Promise<TimelineProfile> {
  const cdp = await page.context().newCDPSession(page)
  if (options.cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: options.cpuThrottle })
  if (options.profileCPU) {
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 })
    await cdp.send("Profiler.start")
  }
  return { cdp, ...options }
}

export async function stopTimelineProfile(profile: TimelineProfile) {
  if (!profile.profileCPU) return
  const result = await profile.cdp.send("Profiler.stop")
  const self = new Map<number, number>()
  result.profile.samples?.forEach((id, index) => {
    const duration = (result.profile.timeDeltas?.[index] ?? 0) / 1_000
    self.set(id, (self.get(id) ?? 0) + duration)
  })
  console.log(
    "timeline cpu profile",
    JSON.stringify(
      result.profile.nodes
        .map((node) => ({
          function: node.callFrame.functionName || "(anonymous)",
          url: node.callFrame.url,
          line: node.callFrame.lineNumber + 1,
          selfMs: self.get(node.id) ?? 0,
        }))
        .filter((node) => node.selfMs > 1)
        .sort((a, b) => b.selfMs - a.selfMs)
        .slice(0, 40),
    ),
  )
}

export async function resetTimelineProfile(profile: TimelineProfile) {
  if (profile.cpuThrottle > 1) await profile.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
}

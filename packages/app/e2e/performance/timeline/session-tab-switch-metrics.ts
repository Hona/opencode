export type SessionSwitchSample = {
  observedAtMs: number
  destination: string[]
  source: string[]
  last: boolean
  bottomErrorPx?: number
}

export function classifySessionSwitch(samples: SessionSwitchSample[]) {
  const firstDestination = samples.findIndex((sample) => sample.destination.length > 0)
  const firstCorrect = samples.findIndex((sample) => sample.last && Math.abs(sample.bottomErrorPx ?? Infinity) <= 1)
  const stable = samples.findIndex((_, index) => isStableDestination(samples.slice(index, index + 3)))
  return {
    firstDestinationObservedMs: samples[firstDestination]!.observedAtMs,
    firstCorrectObservedMs: samples[firstCorrect]!.observedAtMs,
    stableObservedMs: samples[stable + 2]!.observedAtMs,
    wrongDestinationSamples: samples
      .slice(firstDestination)
      .filter((sample) => sample.destination.length > 0 && !sample.last).length,
    blankSamples: samples.filter((sample) => sample.destination.length === 0 && sample.source.length === 0).length,
    sourceSamples: samples.filter((sample) => sample.source.length > 0).length,
  }
}

export function isStableDestination(samples: Pick<SessionSwitchSample, "last" | "bottomErrorPx">[]) {
  return (
    samples.length === 3 && samples.every((sample) => sample.last && Math.abs(sample.bottomErrorPx ?? Infinity) <= 1)
  )
}

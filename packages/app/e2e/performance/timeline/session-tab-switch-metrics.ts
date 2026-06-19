export type SessionSwitchSample = {
  observedAtMs: number
  destination: string[]
  source: string[]
  hasVisibleRows: boolean
  last: boolean
  bottomErrorPx?: number
}

export function classifySessionSwitch(samples: SessionSwitchSample[]) {
  const firstDestination = samples.findIndex((sample) => sample.destination.length > 0)
  const correct = (sample: SessionSwitchSample) =>
    sample.destination.length > 0 &&
    sample.source.length === 0 &&
    sample.last &&
    Math.abs(sample.bottomErrorPx ?? Infinity) <= 1
  const firstCorrect = samples.findIndex(correct)
  const stable = samples.findIndex((_, index) => {
    const window = samples.slice(index, index + 3)
    return window.length === 3 && window.every(correct)
  })
  return {
    firstDestinationObservedMs: samples[firstDestination]!.observedAtMs,
    firstCorrectObservedMs: samples[firstCorrect]!.observedAtMs,
    stableObservedMs: samples[stable + 2]!.observedAtMs,
    wrongDestinationSamples: samples
      .slice(firstDestination)
      .filter((sample) => sample.destination.length > 0 && !sample.last).length,
    blankSamples: samples.filter((sample) => !sample.hasVisibleRows).length,
    unknownSamples: samples.filter(
      (sample) => sample.hasVisibleRows && sample.destination.length === 0 && sample.source.length === 0,
    ).length,
    sourceSamples: samples.filter((sample) => sample.source.length > 0).length,
  }
}

export function isStableDestination(samples: Pick<SessionSwitchSample, "last" | "bottomErrorPx">[]) {
  return (
    samples.length === 3 && samples.every((sample) => sample.last && Math.abs(sample.bottomErrorPx ?? Infinity) <= 1)
  )
}

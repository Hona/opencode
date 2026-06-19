export type SessionSwitchSample = {
  at: number
  destination: string[]
  source: string[]
  last: boolean
  bottomError?: number
}

export function blankSessionSwitchSample(at: number): SessionSwitchSample {
  return { at, destination: [], source: [], last: false }
}

export function classifySessionSwitch(samples: SessionSwitchSample[]) {
  const firstDestination = samples.findIndex((sample) => sample.destination.length > 0)
  const firstCorrect = samples.findIndex((sample) => sample.last && Math.abs(sample.bottomError ?? Infinity) <= 1)
  const stable = samples.findIndex((_, index) => isStableDestination(samples.slice(index, index + 3)))
  return {
    firstDestinationMs: samples[firstDestination]!.at,
    firstCorrectMs: samples[firstCorrect]!.at,
    stableMs: samples[stable + 2]!.at,
    wrongDestinationFrames: samples
      .slice(firstDestination)
      .filter((sample) => sample.destination.length > 0 && !sample.last).length,
    blankFrames: samples.filter((sample) => sample.destination.length === 0 && sample.source.length === 0).length,
    sourceFrames: samples.filter((sample) => sample.source.length > 0).length,
  }
}

export function isStableDestination(samples: Pick<SessionSwitchSample, "last" | "bottomError">[]) {
  return samples.length === 3 && samples.every((sample) => sample.last && Math.abs(sample.bottomError ?? Infinity) <= 1)
}

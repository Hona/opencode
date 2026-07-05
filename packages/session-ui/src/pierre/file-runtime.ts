type ReadyWatcher = {
  observer?: MutationObserver
  token: number
  frames: Set<number>
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frame: number) => void
}

export function createReadyWatcher(
  scheduler = {
    request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel: (frame: number) => cancelAnimationFrame(frame),
  },
): ReadyWatcher {
  return { token: 0, frames: new Set(), requestFrame: scheduler.request, cancelFrame: scheduler.cancel }
}

export function clearReadyWatcher(state: ReadyWatcher) {
  state.token++
  state.observer?.disconnect()
  state.observer = undefined
  state.frames.forEach((frame) => state.cancelFrame(frame))
  state.frames.clear()
}

function disconnectReadyObserver(state: ReadyWatcher) {
  state.observer?.disconnect()
  state.observer = undefined
}

function requestReadyFrame(state: ReadyWatcher, token: number, callback: FrameRequestCallback) {
  if (token !== state.token) return
  const frame = state.requestFrame((time) => {
    state.frames.delete(frame)
    if (token !== state.token) return
    callback(time)
  })
  state.frames.add(frame)
}

export function getViewerHost(container: HTMLElement | undefined) {
  if (!container) return
  const host = container.querySelector("diffs-container")
  if (!(host instanceof HTMLElement)) return
  return host
}

export function getViewerRoot(container: HTMLElement | undefined) {
  return getViewerHost(container)?.shadowRoot ?? undefined
}

export function applyViewerScheme(host: HTMLElement | undefined) {
  if (!host) return
  if (typeof document === "undefined") return

  const scheme = document.documentElement.dataset.colorScheme
  if (scheme === "dark" || scheme === "light") {
    host.dataset.colorScheme = scheme
    return
  }

  host.removeAttribute("data-color-scheme")
}

export function observeViewerScheme(getHost: () => HTMLElement | undefined) {
  if (typeof document === "undefined") return () => {}

  applyViewerScheme(getHost())
  if (typeof MutationObserver === "undefined") return () => {}

  const root = document.documentElement
  const monitor = new MutationObserver(() => applyViewerScheme(getHost()))
  monitor.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] })
  return () => monitor.disconnect()
}

export function notifyShadowReady(opts: {
  state: ReadyWatcher
  container: HTMLElement
  getRoot: () => ShadowRoot | undefined
  isReady: (root: ShadowRoot) => boolean
  onReady: () => void
  settleFrames?: number
}) {
  clearReadyWatcher(opts.state)

  const token = opts.state.token
  const settle = Math.max(0, opts.settleFrames ?? 0)

  const runReady = () => {
    const step = (left: number) => {
      if (token !== opts.state.token) return
      if (left <= 0) {
        opts.onReady()
        return
      }
      requestReadyFrame(opts.state, token, () => step(left - 1))
    }

    requestReadyFrame(opts.state, token, () => step(settle))
  }

  const observeRoot = (root: ShadowRoot) => {
    if (opts.isReady(root)) {
      runReady()
      return
    }

    if (typeof MutationObserver === "undefined") return

    disconnectReadyObserver(opts.state)
    opts.state.observer = new MutationObserver(() => {
      if (token !== opts.state.token) return
      if (!opts.isReady(root)) return

      disconnectReadyObserver(opts.state)
      runReady()
    })
    opts.state.observer.observe(root, { childList: true, subtree: true })
  }

  const root = opts.getRoot()
  if (!root) {
    if (typeof MutationObserver === "undefined") return

    opts.state.observer = new MutationObserver(() => {
      if (token !== opts.state.token) return

      const next = opts.getRoot()
      if (!next) return

      observeRoot(next)
    })
    opts.state.observer.observe(opts.container, { childList: true, subtree: true })
    return
  }

  observeRoot(root)
}

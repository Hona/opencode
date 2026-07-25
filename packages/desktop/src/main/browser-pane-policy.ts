import { BrowserControl } from "@opencode-ai/sdk-next/browser-control"
import type { BrowserPaneBounds } from "../preload/types"

export const normalizeBrowserURL = BrowserControl.normalizeURL
export const allowedBrowserURL = BrowserControl.allowedURL
export const normalizeBrowserRef = BrowserControl.normalizeRef

export function browserContextPartition(windowID: number, sessionID: string) {
  return `opencode-browser-${windowID}-${sessionID.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

export const browserContextLimit = 4
export const browserSnapshotLimit = 500

export function browserSnapshotExpression(nextRef: number, limit = browserSnapshotLimit) {
  return `(() => {
    const interactive = new Set(["button","checkbox","combobox","link","menuitem","option","radio","searchbox","slider","spinbutton","switch","tab","textbox"])
    const readable = new Set(["article","cell","columnheader","heading","img","list","listitem","p","region","row","rowheader","table"])
    const roleFor = (element) => {
      const explicit = element.getAttribute("role")
      if (explicit) return explicit.slice(0, 100).split(/\\s+/)[0]
      if (/^H[1-6]$/.test(element.tagName)) return "heading"
      if (element.tagName === "INPUT") {
        if (element.type === "checkbox") return "checkbox"
        if (element.type === "radio") return "radio"
        if (element.type === "range") return "slider"
        if (element.type === "number") return "spinbutton"
        if (element.type === "search") return "searchbox"
        return "textbox"
      }
      return ({A:"link",ARTICLE:"article",BUTTON:"button",IMG:"img",LI:"listitem",OL:"list",P:"p",SELECT:"combobox",TABLE:"table",TD:"cell",TH:"columnheader",TR:"row",TEXTAREA:"textbox",UL:"list"})[element.tagName] || element.tagName.toLowerCase()
    }
    const clean = (value) => String(value || "").slice(0, 1000).replace(/\\s+/g, " ").trim().slice(0, 300)
    const textFor = (element) => {
      const queue = []
      for (let index = 0; index < element.childNodes.length && queue.length < 20; index++) queue.push(element.childNodes[index])
      const parts = []
      let visited = 0
      while (queue.length && visited++ < 20) {
        const item = queue.shift()
        if (item.nodeType === Node.TEXT_NODE) parts.push(item.nodeValue || "")
        for (let index = 0; index < item.childNodes.length && queue.length + visited < 20; index++) queue.push(item.childNodes[index])
      }
      return parts.join(" ")
    }
    const nameFor = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby")
      const label = labelledBy && document.getElementById(labelledBy)
      return element.getAttribute("aria-label") || (label && textFor(label)) || element.alt || textFor(element)
    }
    const nodes = []
    const refs = Object.create(null)
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT)
    let visited = 0
    let ref = ${Math.max(0, Math.floor(nextRef))}
    while (visited++ < ${Math.max(1, Math.floor(limit))}) {
      const element = walker.nextNode()
      if (!element) break
      if (element.hidden || element.getAttribute("aria-hidden") === "true" || (element.tagName === "INPUT" && element.type === "hidden")) continue
      const role = clean(roleFor(element)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "node"
      const isInteractive = interactive.has(role) || element.tabIndex >= 0
      const isReadable = readable.has(role)
      if (!isInteractive && !isReadable) continue
      const editable = ["textbox","searchbox","combobox","spinbutton"].includes(role) || element.isContentEditable || element.type === "password"
      const token = isInteractive ? "e" + (++ref) : undefined
      if (token) refs[token] = element
      let depth = 0
      for (let item = element.parentElement; item && depth < 6; item = item.parentElement) depth++
      nodes.push({
        token,
        role,
        name: clean(nameFor(element)),
        value: editable ? "" : clean(element.value),
        depth,
        checked: "checked" in element ? Boolean(element.checked) : undefined,
        disabled: "disabled" in element ? Boolean(element.disabled) : undefined,
        expanded: element.getAttribute("aria-expanded") === "true" ? true : element.getAttribute("aria-expanded") === "false" ? false : undefined,
        selected: "selected" in element ? Boolean(element.selected) : undefined,
      })
    }
    return { result: { nodes, nextRef: ref }, refs }
  })()`
}

export function browserContextEvictions(
  contexts: ReadonlyArray<{ readonly id: string; readonly attached: boolean; readonly lastUsed: number }>,
  limit = browserContextLimit,
) {
  const count = Math.max(0, contexts.length - limit)
  return contexts
    .filter((context) => !context.attached)
    .toSorted((left, right) => left.lastUsed - right.lastUsed)
    .slice(0, count)
    .map((context) => context.id)
}

export function ownBrowserParentListeners(input: {
  readonly addNavigation: (listener: () => void) => void
  readonly removeNavigation: (listener: () => void) => void
  readonly addCrash: (listener: () => void) => void
  readonly removeCrash: (listener: () => void) => void
  readonly detach: () => void
}) {
  let active = true
  const didStartNavigation = () => {
    if (active) input.detach()
  }
  const renderProcessGone = () => {
    if (active) input.detach()
  }
  input.addNavigation(didStartNavigation)
  input.addCrash(renderProcessGone)
  return {
    didStartNavigation,
    renderProcessGone,
    dispose() {
      if (!active) return
      active = false
      input.removeNavigation(didStartNavigation)
      input.removeCrash(renderProcessGone)
    },
  }
}

export function invalidateBrowserRefs(state: { snapshot: number; refs: { clear(): void } }) {
  state.snapshot++
  state.refs.clear()
}

export function privateBrowserOrigin(input: string) {
  if (!URL.canParse(input)) return undefined
  const url = new URL(input)
  if (url.protocol === "file:") return "file:"
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return url.origin
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) return url.origin
  const parts = host.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  const first = parts[0]
  const second = parts[1]
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127)
  )
    return url.origin
  return undefined
}

export function browserDestinationOrigin(input: string) {
  if (input === "about:blank") return "about:blank"
  if (!URL.canParse(input)) return undefined
  const url = new URL(input)
  return url.protocol === "file:" ? "file:" : url.origin
}

export function allowedBrowserDestination(input: string, approvedOrigin?: string) {
  if (!BrowserControl.allowedURL(input)) return false
  if (input === "about:blank") return true
  return browserDestinationOrigin(input) === approvedOrigin
}

export function stopBrowserOperation(input: { active?: AbortController; stop(): void }) {
  input.active?.abort()
  input.stop()
}

export function boundedBrowserOperation<T>(
  run: () => PromiseLike<T>,
  input: {
    signal?: AbortSignal
    timeout: number
    aborted: () => Error
    timedOut: () => Error
  },
) {
  return new Promise<T>((resolve, reject) => {
    type OperationResult = { readonly run: false } | { readonly run: true; readonly value: T }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      input.signal?.removeEventListener("abort", onAbort)
    }
    const succeed = (value: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(input.aborted())

    if (input.signal?.aborted) {
      onAbort()
      return
    }
    input.signal?.addEventListener("abort", onAbort, { once: true })
    timer = setTimeout(() => fail(input.timedOut()), input.timeout)
    void Promise.resolve()
      .then<OperationResult>(() => {
        if (settled) return { run: false }
        return new Promise<OperationResult>((resolve, reject) => {
          run().then(
            (value) => resolve({ run: true, value }),
            (error) => reject(error),
          )
        })
      })
      .then((result) => {
        if (result.run) succeed(result.value)
      }, fail)
  })
}

export async function runBrowserInputPair(input: {
  assert: () => void
  press: () => Promise<void>
  release: () => Promise<void>
}) {
  input.assert()
  try {
    await input.press()
  } finally {
    await input.release()
  }
  input.assert()
}

export function normalizeBrowserBounds(
  input: BrowserPaneBounds,
  parent: BrowserPaneBounds,
): BrowserPaneBounds | undefined {
  if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) return undefined
  const left = Math.max(0, Math.min(Math.round(input.x), parent.width))
  const top = Math.max(0, Math.min(Math.round(input.y), parent.height))
  const right = Math.max(left, Math.min(Math.round(input.x + input.width), parent.width))
  const bottom = Math.max(top, Math.min(Math.round(input.y + input.height), parent.height))
  if (right === left || bottom === top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Opaque corner masks cut only the bottom edge while the native view keeps square top corners. */
export function browserBottomMasks(bounds: BrowserPaneBounds) {
  if (bounds.width < 20 || bounds.height < 10) return []
  const segments = [
    { offset: 0, height: 2, width: 6 },
    { offset: 2, height: 2, width: 3 },
    { offset: 4, height: 2, width: 2 },
    { offset: 6, height: 4, width: 1 },
  ]
  return segments.flatMap((segment) => {
    const y = bounds.y + bounds.height - segment.offset - segment.height
    return [
      { x: bounds.x, y, width: segment.width, height: segment.height },
      { x: bounds.x + bounds.width - segment.width, y, width: segment.width, height: segment.height },
    ]
  })
}

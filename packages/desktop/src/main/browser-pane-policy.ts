import { Buffer } from "node:buffer"

export type BrowserPaneBounds = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function normalizeBrowserURL(input: string) {
  const value = input.trim()
  if (value.length > 16_384) throw new Error("Browser URL is too long")
  if (!value || value === "about:blank") return "about:blank"
  const candidate = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?(?:\/|$)/i.test(value)
    ? `http://${value}`
    : /^[a-z][a-z\d+.-]*:/i.test(value)
      ? value
      : `https://${value}`
  if (!URL.canParse(candidate)) throw new Error("Enter a valid HTTP or HTTPS URL")
  const url = new URL(candidate)
  if (!allowedBrowserURL(url.href)) {
    throw new Error("Only HTTP, HTTPS, and about:blank URLs without credentials are supported")
  }
  if (url.href.length > 16_384) throw new Error("Browser URL is too long")
  return url.href
}

export function allowedBrowserURL(input: string) {
  if (input === "about:blank") return true
  if (!URL.canParse(input)) return false
  const url = new URL(input)
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
}

export function browserDestinationOrigin(input: string) {
  if (input === "about:blank") return input
  if (!allowedBrowserURL(input)) return undefined
  return new URL(input).origin
}

export function browserHistoryDestinationOrigin(
  history: {
    readonly getActiveIndex: () => number
    readonly getAllEntries: () => ReadonlyArray<{ readonly url: string }>
  },
  offset: number,
) {
  const entry = history.getAllEntries()[history.getActiveIndex() + offset]
  return entry ? browserDestinationOrigin(entry.url) : undefined
}

export function allowedBrowserDestination(input: string, approvedOrigin?: string) {
  if (input === "about:blank") return true
  return approvedOrigin !== undefined && browserDestinationOrigin(input) === approvedOrigin
}

export function normalizeBrowserRef(input: string) {
  const value = input.trim().replace(/^@/, "")
  if (!/^e[1-9][0-9]*$/.test(value)) throw new Error("Enter a valid browser element reference")
  return value
}

export function browserContextPartition(serverKey: string, sessionID: string, bindingID: string, contextID: string) {
  const encode = (value: string) => Buffer.from(value).toString("base64url")
  return `opencode-browser-${encode(serverKey)}-${encode(sessionID)}-${encode(bindingID)}-${encode(contextID)}`
}

export const browserContextLimit = 4

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
    const nameFor = (element, editable) => {
      const labelledBy = element.getAttribute("aria-labelledby")
      const label = labelledBy && document.getElementById(labelledBy)
      return element.getAttribute("aria-label") || (label && textFor(label)) || element.alt || (editable ? "" : textFor(element))
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
      const editable = ["INPUT","TEXTAREA","SELECT"].includes(element.tagName) || ["textbox","searchbox","combobox","spinbutton"].includes(role) || element.isContentEditable
      const token = isInteractive ? "e" + (++ref) : undefined
      if (token) refs[token] = element
      let depth = 0
      for (let item = element.parentElement; item && depth < 6; item = item.parentElement) depth++
      nodes.push({
        token,
        role,
        name: clean(nameFor(element, editable)),
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

export const browserFillFunction = `function(token) {
  const element = this.refs[token]
  if (!element || !element.isConnected) throw new Error("stale element")
  const role = String(element.getAttribute("role") || "").split(/\\s+/, 1)[0]
  const input = element.tagName === "INPUT" && !["button","checkbox","color","file","hidden","image","radio","range","reset","submit"].includes(String(element.type).toLowerCase())
  const editable = input || element.tagName === "TEXTAREA" || element.isContentEditable || ["textbox","searchbox","combobox","spinbutton"].includes(role)
  if (!editable || element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true" || element.getAttribute("aria-readonly") === "true") return false
  element.focus()
  return true
}`

export function invalidateBrowserRefs(state: { snapshot: number; refs: { clear(): void } }) {
  state.snapshot++
  state.refs.clear()
}

export function stopBrowserOperation(input: { readonly active?: AbortController; readonly stop: () => void }) {
  input.active?.abort()
  input.stop()
}

export function boundedBrowserOperation<Result>(
  run: () => PromiseLike<Result>,
  input: {
    readonly signal?: AbortSignal
    readonly timeout: number
    readonly aborted: () => Error
    readonly timedOut: () => Error
  },
) {
  return new Promise<Result>((resolve, reject) => {
    type OperationResult = { readonly ran: false } | { readonly ran: true; readonly value: Result }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      input.signal?.removeEventListener("abort", onAbort)
    }
    const succeed = (value: Result) => {
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
        if (settled) return { ran: false }
        return new Promise<OperationResult>((resolve, reject) => {
          run().then(
            (value) => resolve({ ran: true, value }),
            (error) => reject(error),
          )
        })
      })
      .then((result) => {
        if (result.ran) succeed(result.value)
      }, fail)
  })
}

export async function runBrowserInputPair(input: {
  readonly assert: () => void
  readonly press: () => Promise<void>
  readonly release: () => Promise<void>
}) {
  input.assert()
  try {
    await input.press()
  } finally {
    await input.release()
  }
  input.assert()
}

export function browserProtocolError(input: unknown): (Error & { readonly code: "stale_ref" }) | undefined {
  const message = input instanceof Error ? input.message : String(input)
  if (
    !/Could not find (node|object)|No node with given id|Node with given id does not belong|Could not push node|Could not compute box model|stale element/i.test(
      message,
    )
  )
    return undefined
  return Object.assign(new Error("The element reference is stale. Call browser_snapshot again."), {
    code: "stale_ref" as const,
  })
}

export function normalizeBrowserBounds(input: BrowserPaneBounds, parent: BrowserPaneBounds) {
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

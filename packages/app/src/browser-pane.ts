export type BrowserPaneBounds = { x: number; y: number; width: number; height: number }

export type BrowserPaneLayout = {
  attached: boolean
  visible: boolean
  destroy?: boolean
  background?: string
  sessionID?: string
  bounds?: BrowserPaneBounds
}

export type BrowserPaneCommand =
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "stop" }

export type BrowserPaneState = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
}

export type BrowserPanePlatform = {
  setLayout(layout: BrowserPaneLayout): void
  command(command: BrowserPaneCommand): Promise<void>
  subscribe(cb: (state: BrowserPaneState) => void): Promise<() => void>
}

import type { BrowserControl } from "./browser-control"

export type ListenOptions = {
  readonly app: {
    readonly name: string
    readonly version: string
    readonly channel: string
  }
  readonly hostname: string
  readonly port: number
  readonly password: string
}

export type Listener = { readonly stop: () => Promise<void> }
export type Listen = (options: ListenOptions, browserControl?: BrowserControl.Interface) => Promise<Listener>

export declare const listen: Listen
export declare const Server: { readonly listen: Listen }
export { BrowserControl } from "./browser-control"

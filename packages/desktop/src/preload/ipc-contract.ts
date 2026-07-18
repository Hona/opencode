import type { ServerReadyData } from "./types"

export interface DesktopIpcContract {
  "kill-sidecar": { request: void; response: void }
  "await-initialization": { request: void; response: ServerReadyData }
  "consume-initial-deep-links": { request: void; response: string[] }
  "get-default-server-url": { request: void; response: string | null }
  "set-default-server-url": { request: string | null; response: void }
  "is-first-launch-onboarding-pending": { request: void; response: boolean }
  "finish-first-launch-onboarding": { request: boolean; response: string | null }
  "is-old-layout-eligible": { request: void; response: boolean }
  "get-display-backend": { request: void; response: string | null }
  "set-display-backend": { request: string | null; response: void }
  "parse-markdown": { request: string; response: string }
  "check-app-exists": { request: string; response: boolean }
  "resolve-app-path": { request: string; response: string | null }
  "set-background-color": { request: string; response: void }
  "export-debug-logs": { request: void; response: string }
  "store-get": { request: { name: string; key: string }; response: string | null }
  "store-set": { request: { name: string; key: string; value: string }; response: void }
  "store-delete": { request: { name: string; key: string }; response: void }
  "store-clear": { request: { name: string }; response: void }
  "store-keys": { request: { name: string }; response: string[] }
  "store-length": { request: { name: string }; response: number }
}

export type IpcChannel = keyof DesktopIpcContract

export async function invokeIpcWith<K extends IpcChannel>(
  ipcRenderer: { invoke(channel: string, ...args: any[]): Promise<any> },
  channel: K,
  request: DesktopIpcContract[K]["request"],
): Promise<DesktopIpcContract[K]["response"]> {
  return ipcRenderer.invoke(channel, request)
}

export function handleIpcWith<K extends IpcChannel>(
  ipcMain: { handle(channel: string, listener: (event: any, request: any) => any): void },
  channel: K,
  handler: (request: DesktopIpcContract[K]["request"]) => Promise<DesktopIpcContract[K]["response"]> | DesktopIpcContract[K]["response"],
) {
  ipcMain.handle(channel, (_event, request) => handler(request))
}

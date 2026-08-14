import type { ElectronAPI } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly OPENCODE_TEST_MIGRATION?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}

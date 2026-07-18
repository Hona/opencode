export type SidecarKind = "local" | "wsl"
export type SidecarStatus = "idle" | "starting" | "ready" | "failed" | "stopped"

export interface SidecarInstance {
  readonly id: string
  readonly kind: SidecarKind
  readonly status: SidecarStatus
  getUrl(): Promise<string | null>
  stop(): Promise<void>
}

export class BaseSidecarController implements SidecarInstance {
  private _status: SidecarStatus = "idle"

  constructor(
    public readonly id: string,
    public readonly kind: SidecarKind,
    private fetchUrl: () => Promise<string | null>,
    private stopFn: () => Promise<void>,
  ) {}

  get status(): SidecarStatus {
    return this._status
  }

  async getUrl(): Promise<string | null> {
    this._status = "starting"
    try {
      const url = await this.fetchUrl()
      this._status = url ? "ready" : "failed"
      return url
    } catch (err) {
      this._status = "failed"
      throw err
    }
  }

  async stop(): Promise<void> {
    try {
      await this.stopFn()
    } finally {
      this._status = "stopped"
    }
  }
}

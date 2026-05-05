import "node:tls"

declare module "node:tls" {
  export function getCACertificates(type?: "default" | "system" | "bundled" | "extra"): string[]
  export function setDefaultCACertificates(certs: readonly string[]): void
}

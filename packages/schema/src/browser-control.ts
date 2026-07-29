export * as BrowserControl from "./browser-control.js"

import { Schema } from "effect"
import { Browser } from "./browser.js"
import { ascending } from "./identifier.js"
import { SessionID } from "./session-id.js"
import { NonNegativeInt, statics } from "./schema.js"

const RequestIDSchema = Schema.String.check(Schema.isPattern(/^brr_[0-9A-Za-z]+$/))
  .pipe(Schema.brand("BrowserControl.RequestID"))
  .annotate({ identifier: "BrowserControl.RequestID" })

export const RequestID = RequestIDSchema.pipe(
  statics((schema: typeof RequestIDSchema) => ({
    create: () => schema.make("brr_" + ascending()),
  })),
)
export type RequestID = typeof RequestID.Type

const Attachment = Schema.Struct({
  sessionID: SessionID,
  leaseID: Browser.LeaseID,
  state: Browser.State,
}).annotate({ identifier: "BrowserControl.Attachment" })

const Ready = Schema.Struct({
  type: Schema.Literal("browser.control.ready"),
}).annotate({ identifier: "BrowserControl.Ready" })

const Sync = Schema.Struct({
  type: Schema.Literal("browser.control.sync"),
  revision: NonNegativeInt,
  attachments: Schema.Array(Attachment).check(Schema.isMaxLength(16)),
}).annotate({ identifier: "BrowserControl.Sync" })

const Synced = Schema.Struct({
  type: Schema.Literal("browser.control.synced"),
  revision: NonNegativeInt,
}).annotate({ identifier: "BrowserControl.Synced" })

const Request = Schema.Struct({
  type: Schema.Literal("browser.control.request"),
  requestID: RequestID,
  sessionID: SessionID,
  leaseID: Browser.LeaseID,
  command: Browser.Command,
}).annotate({ identifier: "BrowserControl.Request" })

const Response = Schema.Struct({
  type: Schema.Literal("browser.control.response"),
  requestID: RequestID,
  leaseID: Browser.LeaseID,
  outcome: Browser.Outcome,
}).annotate({ identifier: "BrowserControl.Response" })

const Cancel = Schema.Struct({
  type: Schema.Literal("browser.control.cancel"),
  requestID: RequestID,
  leaseID: Browser.LeaseID,
}).annotate({ identifier: "BrowserControl.Cancel" })

export const FromDesktop = Schema.Union([Sync, Response])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.FromDesktop" })
export type FromDesktop = typeof FromDesktop.Type

export const FromServer = Schema.Union([Ready, Synced, Request, Cancel])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.FromServer" })
export type FromServer = typeof FromServer.Type

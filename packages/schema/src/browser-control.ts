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

const AvailableRegistration = Schema.Struct({
  type: Schema.Literal("available"),
  sessionID: SessionID,
}).annotate({ identifier: "BrowserControl.AvailableRegistration" })

const AttachedRegistration = Schema.Struct({
  type: Schema.Literal("attached"),
  sessionID: SessionID,
  leaseID: Browser.LeaseID,
  state: Browser.State,
}).annotate({ identifier: "BrowserControl.AttachedRegistration" })

const Registration = Schema.Union([AvailableRegistration, AttachedRegistration])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.Registration" })

const Ready = Schema.Struct({
  type: Schema.Literal("browser.control.ready"),
}).annotate({ identifier: "BrowserControl.Ready" })

const Sync = Schema.Struct({
  type: Schema.Literal("browser.control.sync"),
  revision: NonNegativeInt,
  registrations: Schema.Array(Registration).check(Schema.isMaxLength(16)),
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

const Reveal = Schema.Struct({
  type: Schema.Literal("browser.control.reveal"),
  requestID: RequestID,
  sessionID: SessionID,
}).annotate({ identifier: "BrowserControl.Reveal" })

const RevealOutcome = Schema.Union([
  Schema.Struct({ type: Schema.Literal("success") }),
  Schema.Struct({
    type: Schema.Literal("failure"),
    message: Schema.String.check(Schema.isMaxLength(1_024)),
  }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.RevealOutcome" })

const Revealed = Schema.Struct({
  type: Schema.Literal("browser.control.revealed"),
  requestID: RequestID,
  outcome: RevealOutcome,
}).annotate({ identifier: "BrowserControl.Revealed" })

const RevealCancel = Schema.Struct({
  type: Schema.Literal("browser.control.reveal.cancel"),
  requestID: RequestID,
}).annotate({ identifier: "BrowserControl.RevealCancel" })

export const FromDesktop = Schema.Union([Sync, Response, Revealed])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.FromDesktop" })
export type FromDesktop = typeof FromDesktop.Type

export const FromServer = Schema.Union([Ready, Synced, Request, Cancel, Reveal, RevealCancel])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserControl.FromServer" })
export type FromServer = typeof FromServer.Type

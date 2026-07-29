export * as BrowserHost from "./browser-host"

import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { Session } from "@opencode-ai/schema/session"
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Scope,
  Stream,
  SynchronizedRef,
} from "effect"
import { SessionStore } from "./session/store"
import { Bus } from "./bus"
import { SessionEvent } from "./session/event"

const PendingLimit = 32

export class OwnerExistsError extends Schema.TaggedErrorClass<OwnerExistsError>()("BrowserHost.OwnerExistsError", {
  message: Schema.String,
}) {}

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()("BrowserHost.ConnectionError", {
  kind: Schema.Literals(["closed", "invalid_message", "message_too_large", "overloaded", "transport"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("BrowserHost.ProtocolError", {
  message: Schema.String,
}) {}

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("BrowserHost.RequestError", {
  code: Browser.ErrorCode,
  message: Schema.String,
}) {}

export class RevealError extends Schema.TaggedErrorClass<RevealError>()("BrowserHost.RevealError", {
  message: Schema.String,
}) {}

export type CloseReason =
  | "disconnected"
  | "protocol_error"
  | "message_too_large"
  | "overloaded"
  | "internal_error"
  | "restart"

export interface Peer {
  readonly messages: Stream.Stream<BrowserControl.FromDesktop, ConnectionError>
  readonly send: (message: BrowserControl.FromServer) => Effect.Effect<void, ConnectionError>
  readonly close: (close: CloseReason, message: string) => Effect.Effect<void>
}

export interface Connection {
  readonly run: (peer: Peer) => Effect.Effect<void, ConnectionError | ProtocolError>
}

export interface Lease {
  readonly id: Browser.LeaseID
  readonly sessionID: Session.ID
  readonly state: Browser.State
  readonly revoked: Effect.Effect<void>
  readonly request: (command: Browser.Command) => Effect.Effect<Browser.Result, RequestError>
}

export interface Registration {
  readonly sessionID: Session.ID
  readonly revoked: Effect.Effect<void>
  readonly reveal: Effect.Effect<void, RevealError>
}

export interface Interface {
  /** Claims the sole desktop browser host for this server process. */
  readonly claim: Effect.Effect<Connection, OwnerExistsError, Scope.Scope>
  readonly registration: (sessionID: Session.ID) => Effect.Effect<Option.Option<Registration>>
  readonly lease: (sessionID: Session.ID) => Effect.Effect<Option.Option<Lease>>
  readonly shutdown: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserHost") {}

type Sync = Extract<BrowserControl.FromDesktop, { readonly type: "browser.control.sync" }>
type Response = Extract<BrowserControl.FromDesktop, { readonly type: "browser.control.response" }>
type Revealed = Extract<BrowserControl.FromDesktop, { readonly type: "browser.control.revealed" }>
type RegistrationInfo = Sync["registrations"][number]
type AttachedInfo = Extract<RegistrationInfo, { readonly type: "attached" }>
type Attachment = AttachedInfo & {
  readonly token: object
  readonly revoked: Deferred.Deferred<void>
}

type RegistrationRecord = {
  readonly token: object
  readonly sessionID: Session.ID
  readonly revoked: Deferred.Deferred<void>
  readonly attachment?: Attachment
}

type Pending = {
  readonly token: object
  readonly requestID: BrowserControl.RequestID
  readonly sessionID: Session.ID
  readonly leaseID: Browser.LeaseID
  readonly command: Browser.Command
  readonly done: Deferred.Deferred<Browser.Outcome>
}

type PendingReveal = {
  readonly token: object
  readonly requestID: BrowserControl.RequestID
  readonly sessionID: Session.ID
  readonly done: Deferred.Deferred<Revealed["outcome"]>
}

type Active = {
  readonly token: object
  readonly peer?: Peer
  readonly revision: number
  readonly registrations: ReadonlyMap<Session.ID, RegistrationRecord>
  readonly pending: ReadonlyMap<BrowserControl.RequestID, Pending>
  readonly reveals: ReadonlyMap<BrowserControl.RequestID, PendingReveal>
}

type State = {
  readonly shutdown: boolean
  readonly active?: Active
}

type Released = {
  readonly registrations: ReadonlyArray<RegistrationRecord>
  readonly attachments: ReadonlyArray<Attachment>
  readonly pending: ReadonlyArray<Pending>
  readonly reveals: ReadonlyArray<PendingReveal>
  readonly peer?: Peer
}

type SyncResult = {
  readonly revokedRegistrations: ReadonlyArray<RegistrationRecord>
  readonly revokedAttachments: ReadonlyArray<Attachment>
  readonly cancelled: ReadonlyArray<Pending>
  readonly cancelledReveals: ReadonlyArray<PendingReveal>
  readonly peer: Peer
}

type RequestStart =
  | { readonly type: "error"; readonly error: RequestError }
  | { readonly type: "ready"; readonly peer: Peer; readonly pending: Pending }

type RevealStart =
  | { readonly type: "error"; readonly error: RevealError }
  | { readonly type: "ready"; readonly peer: Peer; readonly pending: PendingReveal }

export function make(
  sessionExists: (sessionID: Session.ID) => Effect.Effect<boolean>,
  deleted: Stream.Stream<Session.ID> = Stream.never,
) {
  return Effect.gen(function* () {
    const state = yield* SynchronizedRef.make<State>({ shutdown: false })

    const settleReleased = Effect.fn("BrowserHost.settleReleased")(function* (
      released: Released,
      close: CloseReason,
      reason: string,
    ) {
      for (const registration of released.registrations) Deferred.doneUnsafe(registration.revoked, Effect.void)
      for (const attachment of released.attachments) Deferred.doneUnsafe(attachment.revoked, Effect.void)
      for (const pending of released.pending) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({
            type: "failure",
            code: "not_attached",
            message: "The browser attachment is no longer available.",
          }),
        )
      }
      for (const pending of released.reveals) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({ type: "failure", message: "The browser registration is no longer available." }),
        )
      }
      if (released.peer) yield* released.peer.close(close, reason)
    })

    const release = Effect.fn("BrowserHost.release")(function* (token: object, close: CloseReason, reason: string) {
      const released = yield* SynchronizedRef.modify(state, (current): readonly [Released, State] => {
        if (current.active?.token !== token) {
          return [{ registrations: [], attachments: [], pending: [], reveals: [] }, current]
        }
        return [
          {
            registrations: Array.from(current.active.registrations.values()),
            attachments: Array.from(current.active.registrations.values()).flatMap((item) =>
              item.attachment ? [item.attachment] : [],
            ),
            pending: Array.from(current.active.pending.values()),
            reveals: Array.from(current.active.reveals.values()),
            peer: current.active.peer,
          },
          { shutdown: current.shutdown },
        ]
      })
      yield* settleReleased(released, close, reason)
    })

    const revokeSession = Effect.fn("BrowserHost.revokeSession")(function* (sessionID: Session.ID) {
      const revoked = yield* SynchronizedRef.modify(state, (current): readonly [Released, State] => {
        const active = current.active
        const registration = active?.registrations.get(sessionID)
        if (!active || !registration) {
          return [{ registrations: [], attachments: [], pending: [], reveals: [] }, current]
        }
        const registrations = new Map(active.registrations)
        registrations.delete(sessionID)
        const pending = Array.from(active.pending.values()).filter((item) => item.sessionID === sessionID)
        const pendingIDs = new Set(pending.map((item) => item.requestID))
        const reveals = Array.from(active.reveals.values()).filter((item) => item.sessionID === sessionID)
        const revealIDs = new Set(reveals.map((item) => item.requestID))
        return [
          {
            registrations: [registration],
            attachments: registration.attachment ? [registration.attachment] : [],
            pending,
            reveals,
            peer: active.peer,
          },
          {
            shutdown: current.shutdown,
            active: {
              ...active,
              registrations,
              pending: new Map(Array.from(active.pending).filter(([requestID]) => !pendingIDs.has(requestID))),
              reveals: new Map(Array.from(active.reveals).filter(([requestID]) => !revealIDs.has(requestID))),
            },
          },
        ]
      })
      for (const pending of revoked.pending) {
        if (!revoked.peer) break
        yield* revoked.peer
          .send({ type: "browser.control.cancel", requestID: pending.requestID, leaseID: pending.leaseID })
          .pipe(Effect.catch(() => Effect.void))
      }
      for (const pending of revoked.reveals) {
        if (!revoked.peer) break
        yield* revoked.peer
          .send({ type: "browser.control.reveal.cancel", requestID: pending.requestID })
          .pipe(Effect.catch(() => Effect.void))
      }
      for (const registration of revoked.registrations) Deferred.doneUnsafe(registration.revoked, Effect.void)
      for (const attachment of revoked.attachments) Deferred.doneUnsafe(attachment.revoked, Effect.void)
      for (const pending of revoked.pending) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({
            type: "failure",
            code: "not_attached",
            message: "The browser Session no longer exists.",
          }),
        )
      }
      for (const pending of revoked.reveals) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({ type: "failure", message: "The browser Session no longer exists." }),
        )
      }
    })

    const sync = Effect.fn("BrowserHost.sync")(function* (token: object, input: Sync) {
      const sessionIDs = new Set(input.registrations.map((registration) => registration.sessionID))
      const attached = input.registrations.filter((registration) => registration.type === "attached")
      const leaseIDs = new Set(attached.map((registration) => registration.leaseID))
      if (sessionIDs.size !== input.registrations.length || leaseIDs.size !== attached.length) {
        return yield* new ProtocolError({
          message: "Browser registration snapshots must contain unique Sessions and leases.",
        })
      }
      const existing = yield* Effect.forEach(
        input.registrations,
        (registration) => sessionExists(registration.sessionID),
        { concurrency: "unbounded" },
      )
      if (existing.some((value) => !value)) {
        return yield* new ProtocolError({ message: "Browser registration snapshot contains an unknown Session." })
      }

      const result = yield* SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (current) {
          const active = current.active
          if (active?.token !== token || !active.peer) {
            return yield* new ProtocolError({ message: "Browser control connection is no longer active." })
          }
          if (input.revision <= active.revision) {
            return yield* new ProtocolError({ message: "Browser attachment revision must increase monotonically." })
          }

          const next = new Map<Session.ID, RegistrationRecord>()
          for (const info of input.registrations) {
            const previous = active.registrations.get(info.sessionID)
            const attachment =
              info.type === "available"
                ? undefined
                : previous?.attachment?.leaseID === info.leaseID
                  ? { ...previous.attachment, state: info.state }
                  : { ...info, token: {}, revoked: Deferred.makeUnsafe<void>() }
            next.set(info.sessionID, {
              token: previous?.token ?? {},
              sessionID: info.sessionID,
              revoked: previous?.revoked ?? Deferred.makeUnsafe<void>(),
              attachment,
            })
          }

          const revokedRegistrations = Array.from(active.registrations.values()).filter(
            (registration) => next.get(registration.sessionID)?.token !== registration.token,
          )
          const revokedAttachments = Array.from(active.registrations.values()).flatMap((registration) => {
            const attachment = registration.attachment
            if (!attachment || next.get(registration.sessionID)?.attachment?.token === attachment.token) return []
            return [attachment]
          })
          const cancelled = Array.from(active.pending.values()).filter(
            (pending) => next.get(pending.sessionID)?.attachment?.leaseID !== pending.leaseID,
          )
          const cancelledReveals = Array.from(active.reveals.values()).filter(
            (pending) => !next.has(pending.sessionID),
          )
          const cancelledIDs = new Set(cancelled.map((pending) => pending.requestID))
          const cancelledRevealIDs = new Set(cancelledReveals.map((pending) => pending.requestID))
          const pending = new Map(Array.from(active.pending).filter(([requestID]) => !cancelledIDs.has(requestID)))
          const reveals = new Map(
            Array.from(active.reveals).filter(([requestID]) => !cancelledRevealIDs.has(requestID)),
          )
          return [
            { revokedRegistrations, revokedAttachments, cancelled, cancelledReveals, peer: active.peer },
            {
              shutdown: current.shutdown,
              active: { ...active, revision: input.revision, registrations: next, pending, reveals },
            },
          ] as readonly [SyncResult, State]
        }),
      )

      for (const registration of result.revokedRegistrations) Deferred.doneUnsafe(registration.revoked, Effect.void)
      for (const attachment of result.revokedAttachments) Deferred.doneUnsafe(attachment.revoked, Effect.void)
      for (const pending of result.cancelled) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({
            type: "failure",
            code: "not_attached",
            message: "The browser attachment was replaced.",
          }),
        )
        yield* result.peer
          .send({
            type: "browser.control.cancel",
            requestID: pending.requestID,
            leaseID: pending.leaseID,
          })
          .pipe(Effect.catch(() => Effect.void))
      }
      for (const pending of result.cancelledReveals) {
        Deferred.doneUnsafe(
          pending.done,
          Effect.succeed({ type: "failure", message: "The browser registration was removed." }),
        )
        yield* result.peer
          .send({ type: "browser.control.reveal.cancel", requestID: pending.requestID })
          .pipe(Effect.catch(() => Effect.void))
      }
      return yield* result.peer.send({ type: "browser.control.synced", revision: input.revision })
    })

    const respond = Effect.fn("BrowserHost.respond")(function* (token: object, input: Response) {
      const pending = yield* SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (current) {
          const active = current.active
          if (active?.token !== token) {
            return yield* new ProtocolError({ message: "Browser control connection is no longer active." })
          }
          const pending = active.pending.get(input.requestID)
          if (!pending) return [undefined, current] as readonly [Pending | undefined, State]
          if (pending.leaseID !== input.leaseID) {
            return yield* new ProtocolError({ message: "Browser response lease does not match its request." })
          }
          if (input.outcome.type === "success" && !compatible(pending.command, input.outcome.result)) {
            return yield* new ProtocolError({ message: "Browser response result does not match its request command." })
          }
          const next = new Map(active.pending)
          next.delete(input.requestID)
          return [pending, { shutdown: current.shutdown, active: { ...active, pending: next } }] as readonly [
            Pending | undefined,
            State,
          ]
        }),
      )
      if (pending) Deferred.doneUnsafe(pending.done, Effect.succeed(input.outcome))
    })

    const respondReveal = Effect.fn("BrowserHost.respondReveal")(function* (token: object, input: Revealed) {
      const pending = yield* SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (current) {
          const active = current.active
          if (active?.token !== token) {
            return yield* new ProtocolError({ message: "Browser control connection is no longer active." })
          }
          const pending = active.reveals.get(input.requestID)
          if (!pending) return [undefined, current] as readonly [PendingReveal | undefined, State]
          const reveals = new Map(active.reveals)
          reveals.delete(input.requestID)
          return [pending, { shutdown: current.shutdown, active: { ...active, reveals } }] as readonly [
            PendingReveal | undefined,
            State,
          ]
        }),
      )
      if (pending) Deferred.doneUnsafe(pending.done, Effect.succeed(input.outcome))
    })

    const receive = Effect.fn("BrowserHost.receive")(function* (token: object, message: BrowserControl.FromDesktop) {
      if (message.type === "browser.control.sync") return yield* sync(token, message)
      if (message.type === "browser.control.response") return yield* respond(token, message)
      return yield* respondReveal(token, message)
    })

    const removePending = Effect.fn("BrowserHost.removePending")(function* (token: object, pending: Pending) {
      return yield* SynchronizedRef.modify(state, (current): readonly [boolean, State] => {
        const active = current.active
        if (active?.token !== token || active.pending.get(pending.requestID)?.token !== pending.token) {
          return [false, current]
        }
        const next = new Map(active.pending)
        next.delete(pending.requestID)
        return [true, { shutdown: current.shutdown, active: { ...active, pending: next } }]
      })
    })

    const cancel = Effect.fn("BrowserHost.cancel")(function* (token: object, peer: Peer, pending: Pending) {
      if (!(yield* removePending(token, pending))) return
      yield* peer
        .send({ type: "browser.control.cancel", requestID: pending.requestID, leaseID: pending.leaseID })
        .pipe(Effect.catch(() => Effect.void))
    })

    const removeReveal = Effect.fn("BrowserHost.removeReveal")(function* (token: object, pending: PendingReveal) {
      return yield* SynchronizedRef.modify(state, (current): readonly [boolean, State] => {
        const active = current.active
        if (active?.token !== token || active.reveals.get(pending.requestID)?.token !== pending.token) {
          return [false, current]
        }
        const reveals = new Map(active.reveals)
        reveals.delete(pending.requestID)
        return [true, { shutdown: current.shutdown, active: { ...active, reveals } }]
      })
    })

    const cancelReveal = Effect.fn("BrowserHost.cancelReveal")(function* (
      token: object,
      peer: Peer,
      pending: PendingReveal,
    ) {
      if (!(yield* removeReveal(token, pending))) return
      yield* peer
        .send({ type: "browser.control.reveal.cancel", requestID: pending.requestID })
        .pipe(Effect.catch(() => Effect.void))
    })

    const request = Effect.fn("BrowserHost.request")(function* (
      connectionToken: object,
      attachment: Attachment,
      command: Browser.Command,
    ) {
      if (!(yield* sessionExists(attachment.sessionID))) {
        yield* revokeSession(attachment.sessionID)
        return yield* new RequestError({ code: "not_attached", message: "The browser Session no longer exists." })
      }
      const pending: Pending = {
        token: {},
        requestID: BrowserControl.RequestID.create(),
        sessionID: attachment.sessionID,
        leaseID: attachment.leaseID,
        command,
        done: Deferred.makeUnsafe<Browser.Outcome>(),
      }
      const start = yield* SynchronizedRef.modify(state, (current): readonly [RequestStart, State] => {
        const active = current.active
        const currentAttachment = active?.registrations.get(attachment.sessionID)?.attachment
        if (
          active?.token !== connectionToken ||
          !active.peer ||
          currentAttachment?.token !== attachment.token ||
          currentAttachment.leaseID !== attachment.leaseID
        ) {
          return [
            {
              type: "error",
              error: new RequestError({
                code: "not_attached",
                message: "The browser attachment is no longer available.",
              }),
            },
            current,
          ]
        }
        if (active.pending.size >= PendingLimit) {
          return [
            {
              type: "error",
              error: new RequestError({
                code: "overloaded",
                message: "The browser host has too many pending requests.",
              }),
            },
            current,
          ]
        }
        return [
          { type: "ready", peer: active.peer, pending },
          {
            shutdown: current.shutdown,
            active: { ...active, pending: new Map(active.pending).set(pending.requestID, pending) },
          },
        ]
      })
      if (start.type === "error") return yield* start.error

      const cancelPending = cancel(connectionToken, start.peer, start.pending)
      const outcome = yield* start.peer
        .send({
          type: "browser.control.request",
          requestID: pending.requestID,
          sessionID: pending.sessionID,
          leaseID: pending.leaseID,
          command,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new RequestError({ code: "internal", message: `Failed to send browser request: ${error.message}` }),
          ),
          Effect.andThen(
            Deferred.await(pending.done).pipe(
              Effect.raceFirst(
                Deferred.await(attachment.revoked).pipe(
                  Effect.andThen(
                    new RequestError({
                      code: "not_attached",
                      message: "The browser attachment is no longer available.",
                    }),
                  ),
                ),
              ),
              Effect.timeoutOrElse({
                duration: command.type === "navigate" ? "30 seconds" : "15 seconds",
                orElse: () =>
                  Effect.fail(new RequestError({ code: "timeout", message: "The browser operation timed out." })),
              }),
            ),
          ),
          Effect.tapError((error) => (error.code === "timeout" ? cancelPending : Effect.void)),
          Effect.onInterrupt(() => cancelPending),
          Effect.ensuring(removePending(connectionToken, pending)),
        )
      if (outcome.type === "failure") return yield* new RequestError(outcome)
      return outcome.result
    })

    const reveal = Effect.fn("BrowserHost.reveal")(function* (
      connectionToken: object,
      registration: RegistrationRecord,
    ) {
      if (!(yield* sessionExists(registration.sessionID))) {
        yield* revokeSession(registration.sessionID)
        return yield* new RevealError({ message: "The browser Session no longer exists." })
      }
      const pending: PendingReveal = {
        token: {},
        requestID: BrowserControl.RequestID.create(),
        sessionID: registration.sessionID,
        done: Deferred.makeUnsafe<Revealed["outcome"]>(),
      }
      const start = yield* SynchronizedRef.modify(state, (current): readonly [RevealStart, State] => {
        const active = current.active
        const currentRegistration = active?.registrations.get(registration.sessionID)
        if (
          active?.token !== connectionToken ||
          !active.peer ||
          currentRegistration?.token !== registration.token
        ) {
          return [
            { type: "error", error: new RevealError({ message: "The browser registration is no longer available." }) },
            current,
          ]
        }
        if (active.pending.size + active.reveals.size >= PendingLimit) {
          return [
            { type: "error", error: new RevealError({ message: "The browser host has too many pending requests." }) },
            current,
          ]
        }
        return [
          { type: "ready", peer: active.peer, pending },
          {
            shutdown: current.shutdown,
            active: { ...active, reveals: new Map(active.reveals).set(pending.requestID, pending) },
          },
        ]
      })
      if (start.type === "error") return yield* start.error

      const cancelPending = cancelReveal(connectionToken, start.peer, start.pending)
      const outcome = yield* start.peer
        .send({
          type: "browser.control.reveal",
          requestID: pending.requestID,
          sessionID: pending.sessionID,
        })
        .pipe(
          Effect.mapError(
            (error) => new RevealError({ message: `Failed to send browser reveal request: ${error.message}` }),
          ),
          Effect.andThen(
            Deferred.await(pending.done).pipe(
              Effect.raceFirst(
                Deferred.await(registration.revoked).pipe(
                  Effect.andThen(new RevealError({ message: "The browser registration is no longer available." })),
                ),
              ),
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () => Effect.fail(new RevealError({ message: "The browser pane did not open in time." })),
              }),
            ),
          ),
          Effect.tapError(() => cancelPending),
          Effect.onInterrupt(() => cancelPending),
          Effect.ensuring(removeReveal(connectionToken, pending)),
        )
      if (outcome.type === "failure") return yield* new RevealError({ message: outcome.message })
    })

    const claim: Interface["claim"] = Effect.gen(function* () {
      const token = {}
      yield* SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (current) {
          if (current.active) {
            return yield* new OwnerExistsError({ message: "A desktop browser host is already connected." })
          }
          if (current.shutdown) {
            return yield* new OwnerExistsError({ message: "The desktop browser host is shutting down." })
          }
          return [
            undefined,
            {
              shutdown: false,
              active: { token, revision: -1, registrations: new Map(), pending: new Map(), reveals: new Map() },
            },
          ] as const
        }),
      )
      yield* Effect.addFinalizer(() => release(token, "disconnected", "Browser host disconnected"))
      const started = yield* Ref.make(false)
      return {
        run: Effect.fn("BrowserHost.Connection.run")(function* (peer: Peer) {
          if (yield* Ref.getAndSet(started, true)) {
            return yield* new ProtocolError({ message: "Browser control connection can only run once." })
          }
          const installed = yield* SynchronizedRef.modify(state, (current): readonly [boolean, State] => {
            if (current.active?.token !== token || current.active.peer) return [false, current]
            return [true, { shutdown: current.shutdown, active: { ...current.active, peer } }]
          })
          if (!installed)
            return yield* new ProtocolError({ message: "Browser control connection is no longer active." })
          const synchronized = Deferred.makeUnsafe<void>()
          const running = yield* Effect.forkChild(
            Stream.runForEach(peer.messages, (message) =>
              receive(token, message).pipe(
                Effect.tap(() =>
                  message.type === "browser.control.sync"
                    ? Effect.sync(() => Deferred.doneUnsafe(synchronized, Effect.void))
                    : Effect.void,
                ),
              ),
            ).pipe(
              Effect.onExit((exit) => {
                if (Exit.isSuccess(exit)) return release(token, "disconnected", "Browser host disconnected")
                const error = Cause.squash(exit.cause)
                const close =
                  error instanceof ProtocolError ||
                  (error instanceof ConnectionError && error.kind === "invalid_message")
                    ? "protocol_error"
                    : error instanceof ConnectionError && error.kind === "message_too_large"
                      ? "message_too_large"
                      : error instanceof ConnectionError && error.kind === "overloaded"
                        ? "overloaded"
                        : "internal_error"
                return release(token, close, error instanceof Error ? error.message : "Browser host connection failed")
              }),
            ),
          )
          return yield* Effect.gen(function* () {
            yield* Deferred.await(synchronized).pipe(
              Effect.timeoutOrElse({
                duration: "5 seconds",
                orElse: () =>
                  Effect.fail(
                    new ProtocolError({ message: "Browser host did not publish registrations after connecting." }),
                  ),
              }),
              Effect.raceFirst(
                Fiber.join(running).pipe(
                  Effect.andThen(
                    new ProtocolError({ message: "Browser host disconnected before publishing registrations." }),
                  ),
                ),
              ),
            )
            return yield* Fiber.join(running)
          }).pipe(Effect.ensuring(Fiber.interrupt(running)))
        }),
      }
    })

    const registration: Interface["registration"] = Effect.fn("BrowserHost.registration")(function* (sessionID) {
      if (!(yield* sessionExists(sessionID))) {
        yield* revokeSession(sessionID)
        return Option.none()
      }
      const active = (yield* SynchronizedRef.get(state)).active
      const record = active?.peer ? active.registrations.get(sessionID) : undefined
      if (!active || !record) return Option.none()
      return Option.some({
        sessionID,
        revoked: Deferred.await(record.revoked),
        reveal: reveal(active.token, record),
      })
    })

    const lease: Interface["lease"] = Effect.fn("BrowserHost.lease")(function* (sessionID) {
      if (!(yield* sessionExists(sessionID))) {
        yield* revokeSession(sessionID)
        return Option.none()
      }
      const active = (yield* SynchronizedRef.get(state)).active
      const attachment = active?.peer ? active.registrations.get(sessionID)?.attachment : undefined
      if (!active || !attachment) return Option.none()
      return Option.some({
        id: attachment.leaseID,
        sessionID,
        state: attachment.state,
        revoked: Deferred.await(attachment.revoked),
        request: (command) => request(active.token, attachment, command),
      })
    })

    const shutdown = Effect.gen(function* () {
      const released = yield* SynchronizedRef.modify(state, (current): readonly [Released, State] => [
        current.active
          ? {
              registrations: Array.from(current.active.registrations.values()),
              attachments: Array.from(current.active.registrations.values()).flatMap((item) =>
                item.attachment ? [item.attachment] : [],
              ),
              pending: Array.from(current.active.pending.values()),
              reveals: Array.from(current.active.reveals.values()),
              peer: current.active.peer,
            }
          : { registrations: [], attachments: [], pending: [], reveals: [] },
        { shutdown: true },
      ])
      yield* settleReleased(released, "restart", "Server restarting")
    })

    yield* Stream.runForEach(deleted, revokeSession).pipe(Effect.forkScoped)

    yield* Effect.addFinalizer(() => shutdown)

    return Service.of({ claim, registration, lease, shutdown })
  })
}

function compatible(command: Browser.Command, result: Browser.Result) {
  return command.type === result.type
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionStore.Service
    const bus = yield* Bus.Service
    return yield* make(
      (sessionID) => sessions.get(sessionID).pipe(Effect.map((session) => session !== undefined)),
      bus.subscribe(SessionEvent.Deleted).pipe(Stream.map((event) => event.data.sessionID)),
    )
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, Bus.node],
})

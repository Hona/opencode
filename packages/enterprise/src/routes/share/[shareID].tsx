import { SessionTimeline } from "@opencode-ai/session-ui/timeline"
import type { SessionDocument } from "@opencode-ai/session-ui/document"
import { SessionReview } from "@opencode-ai/session-ui/session-review"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { WorkerPoolProvider } from "@opencode-ai/ui/context/worker-pool"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, ErrorBoundary, Match, Show, Switch, type JSX } from "solid-js"
import { Share } from "~/core/share"
import { Logo, Mark } from "@opencode-ai/ui/logo"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { DateTime } from "luxon"
import { createStore } from "solid-js/store"
import NotFound from "../[...404]"
import { Tabs } from "@opencode-ai/ui/tabs"
import { MessageNav } from "@opencode-ai/session-ui/message-nav"
import { FileSSR } from "@opencode-ai/session-ui/file-ssr"
import { clientOnly } from "@solidjs/start"
import { Meta, Title } from "@solidjs/meta"
import { Base64 } from "js-base64"
import { getRequestEvent } from "solid-js/web"

const ClientOnlyWorkerPoolProvider = clientOnly(() =>
  import("@opencode-ai/session-ui/pierre/worker").then((m) => ({
    default: (props: { children: JSX.Element }) => (
      <WorkerPoolProvider pools={m.getWorkerPools()}>{props.children}</WorkerPoolProvider>
    ),
  })),
)

class SessionDataMissingError extends Error {
  public override readonly name = "SessionDataMissingError"

  constructor(
    public readonly data: { sessionID: string; message?: string },
    options?: ErrorOptions,
  ) {
    super(data.message ?? `Session data is missing: ${data.sessionID}`, options)
  }

  static isInstance(input: unknown): input is SessionDataMissingError {
    return input instanceof Error && input.name === "SessionDataMissingError"
  }
}

const getData = query(async (shareID) => {
  "use server"
  const share = await Share.get(shareID)
  if (!share) throw new SessionDataMissingError({ sessionID: shareID })
  const data = await Share.data(shareID)
  const result: {
    sessionID: string
    shareID: string
    session: Share.SessionRecord[]
    session_diff: {
      [sessionID: string]: Share.SessionDiff[]
    }
    session_status: {
      [sessionID: string]: { type: "idle" }
    }
    messages: {
      [sessionID: string]: Share.Message[]
    }
    model: {
      [sessionID: string]: Share.Model[]
    }
  } = {
    sessionID: share.sessionID,
    shareID,
    session: [],
    session_diff: {
      [share.sessionID]: [],
    },
    session_status: {
      [share.sessionID]: {
        type: "idle",
      },
    },
    messages: {},
    model: {},
  }
  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "session_diff":
        result.session_diff[share.sessionID] = item.data
        break
      case "messages":
        result.messages[item.data.sessionID] = item.data.messages
        break
      case "model":
        result.model[share.sessionID] = item.data
        break
    }
  }
  if (!result.session.some((session) => session.id === share.sessionID))
    throw new SessionDataMissingError({ sessionID: share.sessionID })
  return result
}, "getShareData")

export default function () {
  getRequestEvent()?.response.headers.set(
    "Cache-Control",
    "public, max-age=30, s-maxage=300, stale-while-revalidate=86400",
  )

  const params = useParams()
  const data = createAsync(async () => {
    if (!params.shareID) throw new Error("Missing shareID")
    return getData(params.shareID)
  })

  return (
    <ErrorBoundary
      fallback={(error) => {
        if (SessionDataMissingError.isInstance(error)) {
          return <NotFound />
        }
        console.error(error)
        const details = error instanceof Error ? (error.stack ?? error.message) : String(error)
        return (
          <div class="min-h-screen w-full bg-background-base text-text-base flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p class="text-16-medium">Unable to render this share.</p>
            <p class="text-14-regular text-text-weaker">Check the console for more details.</p>
            <pre class="text-12-mono text-left whitespace-pre-wrap break-words w-full max-w-200 bg-background-stronger rounded-md p-4">
              {details}
            </pre>
          </div>
        )
      }}
    >
      <Meta name="robots" content="noindex, nofollow" />
      <Show when={data()}>
        {(data) => {
          const info = createMemo(() => data().session.find((session) => session.id === data().sessionID))
          if (!info()) throw new Error(`Session ${data().sessionID} not found`)
          const title = createMemo(() => withTimestampedFallback(info()!))
          const ogImage = createMemo(() => {
            const models = new Set<string>()
            const messages = data().messages[data().sessionID] ?? []
            for (const msg of messages) {
              if (msg.type === "assistant") {
                models.add(msg.model.id)
              }
            }
            const modelIDs = Array.from(models)
            const encodedTitle = encodeURIComponent(Base64.encode(encodeURIComponent(title().substring(0, 700))))
            let modelParam: string
            if (modelIDs.length === 1) {
              modelParam = modelIDs[0]
            } else if (modelIDs.length === 2) {
              modelParam = encodeURIComponent(`${modelIDs[0]} & ${modelIDs[1]}`)
            } else if (modelIDs.length > 2) {
              modelParam = encodeURIComponent(`${modelIDs[0]} & ${modelIDs.length - 1} others`)
            } else {
              modelParam = "unknown"
            }
            return `https://social-cards.sst.dev/opencode-share/${encodedTitle}.png?model=${modelParam}&version=v2&id=${data().shareID}`
          })

          return (
            <>
              <Title>{title()} | OpenCode</Title>
              <Meta name="description" content="opencode - The AI coding agent built for the terminal." />
              <Meta property="og:image" content={ogImage()} />
              <Meta name="twitter:image" content={ogImage()} />
              <ClientOnlyWorkerPoolProvider>
                <FileComponentProvider component={FileSSR}>
                  <DataProvider data={data()} directory={info()!.location.directory} sessionID={data().sessionID}>
                    {(() => {
                      const [store, setStore] = createStore({
                        messageId: undefined as string | undefined,
                      })
                      const messages = createMemo(() => data().messages[data().sessionID] ?? [])
                      const userMessages = createMemo(() => messages().filter((message) => message.type === "user"))
                      const firstUserMessage = createMemo(() => userMessages().at(0))
                      const activeMessage = createMemo(
                        () => userMessages().find((message) => message.id === store.messageId) ?? firstUserMessage(),
                      )
                      function setActiveMessage(message: Extract<Share.Message, { type: "user" }> | undefined) {
                        setStore("messageId", message?.id)
                      }
                      const assistant = createMemo(() => messages().find((message) => message.type === "assistant"))
                      const provider = createMemo(() => assistant()?.model.providerID)
                      const modelID = createMemo(() => assistant()?.model.id)
                      const model = createMemo(() => data().model[data().sessionID]?.find((m) => m.id === modelID()))
                      const diffs = createMemo(() => data().session_diff[data().sessionID] ?? [])
                      const document = createMemo(
                        () =>
                          ({
                            sessionID: data().sessionID,
                            messages: messages(),
                            status: { type: "idle" },
                            diffs: diffs(),
                          }) satisfies SessionDocument,
                      )
                      const activeDocument = createMemo(() => {
                        const active = activeMessage()
                        if (!active) return document()
                        const start = messages().findIndex((message) => message.id === active.id)
                        if (start < 0) return document()
                        const relativeEnd = messages()
                          .slice(start + 1)
                          .findIndex((message) => message.type === "user" || message.type === "shell")
                        const end = relativeEnd < 0 ? messages().length : start + relativeEnd + 1
                        return { ...document(), messages: messages().slice(start, end) }
                      })
                      const [diffStyle, setDiffStyle] = createSignal<"unified" | "split">("unified")

                      const title = () => (
                        <div class="flex flex-col gap-4">
                          <div class="flex flex-col gap-2 sm:flex-row sm:gap-4 sm:items-center sm:h-8 justify-start self-stretch">
                            <div class="pl-[2.5px] pr-2 flex items-center gap-1.75 bg-surface-strong shadow-xs-border-base w-fit">
                              <Mark class="shrink-0 w-3 my-0.5" />
                              <div class="text-12-mono text-text-base">v2</div>
                            </div>
                            <div class="flex gap-4 items-center">
                              <div class="flex gap-2 items-center">
                                <Show when={provider()}>
                                  <ProviderIcon id={provider()!} class="size-3.5 shrink-0 text-icon-strong-base" />
                                </Show>
                                <div class="text-12-regular text-text-base">{model()?.name ?? modelID()}</div>
                              </div>
                              <div class="text-12-regular text-text-weaker">
                                {DateTime.fromMillis(info()!.time.created).toFormat("dd MMM yyyy, HH:mm")}
                              </div>
                            </div>
                          </div>
                          <div class="text-left text-16-medium text-text-strong">{title()}</div>
                        </div>
                      )

                      const turns = () => (
                        <div class="relative mt-2 pb-8 min-w-0 w-full h-full overflow-y-auto no-scrollbar">
                          <div class="px-4 py-6">{title()}</div>
                          <div class="mt-4 flex items-start justify-start">
                            <SessionTimeline document={document()} class="min-w-0 w-full" />
                          </div>
                          <div class="px-4 flex items-center justify-center pt-20 pb-8 shrink-0">
                            <Logo class="w-58.5 opacity-12" />
                          </div>
                        </div>
                      )

                      const wide = createMemo(() => diffs().length === 0)

                      return (
                        <div class="relative bg-background-stronger w-screen h-screen overflow-hidden flex flex-col">
                          <header class="h-12 px-6 py-2 flex items-center justify-between self-stretch bg-background-base border-b border-border-weak-base">
                            <div class="">
                              <a href="https://opencode.ai">
                                <Mark />
                              </a>
                            </div>
                            <div class="flex gap-3 items-center">
                              <IconButton
                                as={"a"}
                                href="https://github.com/anomalyco/opencode"
                                target="_blank"
                                icon={<Icon name="github" />}
                                variant="ghost"
                              />
                              <IconButton
                                as={"a"}
                                href="https://opencode.ai/discord"
                                target="_blank"
                                icon={<Icon name="discord" />}
                                variant="ghost"
                              />
                            </div>
                          </header>
                          <div class="select-text flex flex-col flex-1 min-h-0">
                            <div
                              classList={{
                                "hidden w-full flex-1 min-h-0": true,
                                "md:flex": wide(),
                                "lg:flex": !wide(),
                              }}
                            >
                              <div
                                classList={{
                                  "@container relative shrink-0 pt-14 flex flex-col gap-10 min-h-0 w-full": true,
                                }}
                              >
                                <div
                                  classList={{
                                    "w-full flex justify-start items-start min-w-0 px-6": true,
                                  }}
                                >
                                  {title()}
                                </div>
                                <div class="flex items-start justify-start h-full min-h-0">
                                  <Show when={userMessages().length > 1}>
                                    <MessageNav
                                      class="sticky top-0 shrink-0 py-2 pl-4"
                                      messages={userMessages()}
                                      current={activeMessage()}
                                      size="compact"
                                      onMessageSelect={setActiveMessage}
                                      getLabel={(message) => message.text.trim().split("\n")[0]}
                                    />
                                  </Show>
                                  <div class="flex min-w-0 grow flex-col justify-between">
                                    <SessionTimeline document={activeDocument()} class="w-full px-6 pb-20" />
                                    <div classList={{ "w-full flex items-center justify-center pb-8 shrink-0": true }}>
                                      <Logo class="w-58.5 opacity-12" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <Show when={diffs().length > 0}>
                                <div class="@container relative grow pt-14 flex-1 min-h-0 border-l border-border-weak-base">
                                  <SessionReview
                                    diffs={diffs()}
                                    diffStyle={diffStyle()}
                                    onDiffStyleChange={setDiffStyle}
                                    classes={{
                                      root: "pb-20",
                                      header: "px-6",
                                      container: "px-6",
                                    }}
                                  />
                                </div>
                              </Show>
                            </div>
                            <Switch>
                              <Match when={diffs().length > 0}>
                                <Tabs classList={{ "md:hidden": wide(), "lg:hidden": !wide() }}>
                                  <Tabs.List>
                                    <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }}>
                                      Session
                                    </Tabs.Trigger>
                                    <Tabs.Trigger
                                      value="review"
                                      class="w-1/2 !border-r-0"
                                      classes={{ button: "w-full" }}
                                    >
                                      {diffs().length} Files Changed
                                    </Tabs.Trigger>
                                  </Tabs.List>
                                  <Tabs.Content value="session" class="!overflow-hidden">
                                    {turns()}
                                  </Tabs.Content>
                                  <Tabs.Content value="review" class="!overflow-hidden hidden data-[selected]:block">
                                    <div class="relative h-full pt-8 overflow-y-auto no-scrollbar">
                                      <SessionReview
                                        diffs={diffs()}
                                        classes={{
                                          root: "pb-20",
                                          header: "px-4",
                                          container: "px-4",
                                        }}
                                      />
                                    </div>
                                  </Tabs.Content>
                                </Tabs>
                              </Match>
                              <Match when={true}>
                                <div
                                  classList={{ "!overflow-hidden": true, "md:hidden": wide(), "lg:hidden": !wide() }}
                                >
                                  {turns()}
                                </div>
                              </Match>
                            </Switch>
                          </div>
                        </div>
                      )
                    })()}
                  </DataProvider>
                </FileComponentProvider>
              </ClientOnlyWorkerPoolProvider>
            </>
          )
        }}
      </Show>
    </ErrorBoundary>
  )
}

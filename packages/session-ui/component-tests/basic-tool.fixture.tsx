import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { BasicTool } from "../src/components/basic-tool"
import { AssistantReasoningContent } from "../src/message/message-content"

export { getCachedMarkdown } from "../src/components/markdown-cache"

export function mountReasoning() {
  const host = document.createElement("div")
  host.dataset.testid = "reasoning-fixture"
  document.body.appendChild(host)
  render(
    () => (
      <AssistantReasoningContent
        id="cold-reasoning"
        content={{ type: "reasoning", text: "## Cold reasoning\n\n**Ready when opened.**" }}
        streaming={false}
      />
    ),
    host,
  )
}

export function mountBasicTool(knownContent: boolean) {
  const host = document.createElement("div")
  host.dataset.testid = "basic-tool-fixture"
  document.body.appendChild(host)
  render(() => {
    const [state, setState] = createStore({ open: false, mounts: 0 })
    function Details() {
      setState("mounts", (value) => value + 1)
      const [selection, setSelection] = createStore({ value: "initial" })
      return (
        <input
          aria-label="Detail choice"
          value={selection.value}
          onInput={(event) => setSelection("value", event.currentTarget.value)}
        />
      )
    }
    return (
      <>
        <output data-testid="detail-mounts">{state.mounts}</output>
        <BasicTool
          icon="glasses"
          trigger="Details"
          hasContent={knownContent ? true : undefined}
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
        >
          <Details />
        </BasicTool>
      </>
    )
  }, host)
}

export function mountBasicToolTriggers() {
  const host = document.createElement("div")
  host.dataset.testid = "basic-tool-triggers-fixture"
  document.body.appendChild(host)
  render(() => {
    const [state, setState] = createStore({ mode: "jsx", label: "Initial title", constructions: 0 })
    function Title(props: { label: string }) {
      // Count construction, including JSX created by unused trigger getter reads.
      setState("constructions", (value) => value + 1)
      return (
        <span data-testid="jsx-trigger" title={props.label}>
          {props.label}
        </span>
      )
    }
    return (
      <>
        <output data-testid="trigger-constructions">{state.constructions}</output>
        <input
          aria-label="Trigger label"
          value={state.label}
          onInput={(event) => setState("label", event.currentTarget.value)}
        />
        <button onClick={() => setState("mode", "structured")}>Use structured title</button>
        <button onClick={() => setState("mode", "function")}>Use function trigger</button>
        <BasicTool
          icon="glasses"
          hasContent
          trigger={
            state.mode === "jsx" ? (
              <Title label={state.label} />
            ) : state.mode === "structured" ? (
              { title: state.label, subtitle: "Tool subtitle", args: ["path=src"] }
            ) : (
              (open) => (
                <span>
                  {state.label}: {open() ? "open" : "closed"}
                </span>
              )
            )
          }
        >
          <p>Tool details</p>
        </BasicTool>
      </>
    )
  }, host)
}

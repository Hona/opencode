import { createSignal, type JSX } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { writeClipboard } from "./write-clipboard"

export function ConsoleOutput(props: { copy: string; children: JSX.Element }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    if (!props.copy) return
    if (!(await writeClipboard(props.copy))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-component="bash-output" dir="ltr">
      <div data-slot="bash-copy">
        <TooltipV2 value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top">
          <IconButtonV2
            icon={<IconV2 name={copied() ? "check" : "outline-copy"} size="small" />}
            size="normal"
            variant="ghost-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={copy}
            aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
          />
        </TooltipV2>
      </div>
      <div
        data-slot="bash-scroll"
        data-scrollable
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        <pre data-slot="bash-pre">
          <code>{props.children}</code>
        </pre>
      </div>
    </div>
  )
}

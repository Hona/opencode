import { For, Show } from "solid-js"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { notices } from "./notices"

export default function DialogThirdPartyNotices() {
  const language = useLanguage()

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.about.notices.title")}
          description={language.t("settings.about.notices.description")}
        />
      </DialogHeader>
      <DialogBody class="settings-notices">
        <For each={notices}>
          {(entry) => (
            <section class="settings-notice">
              <div class="settings-notice-heading">
                <ExternalLink href={entry.url}>{entry.name}</ExternalLink>
                <span>{entry.license}</span>
              </div>
              <p>{entry.detail}</p>
              <Show when={entry.notice}>{(notice) => <pre>{notice()}</pre>}</Show>
              <details>
                <summary>{language.t("settings.about.notices.license")}</summary>
                <pre>{entry.text}</pre>
              </details>
            </section>
          )}
        </For>
      </DialogBody>
    </Dialog>
  )
}

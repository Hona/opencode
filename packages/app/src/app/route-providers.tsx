import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PromptProvider } from "@/context/prompt"
import { TerminalProvider } from "@/context/terminal"
import type { Accessor, ParentProps } from "solid-js"

export function ServerProviders(
  props: ParentProps<{
    directory: Accessor<string | undefined>
    sessionID: Accessor<string | undefined>
  }>,
) {
  return (
    <PermissionProvider directory={props.directory}>
      <LayoutProvider>
        <NotificationProvider directory={props.directory} sessionID={props.sessionID}>
          <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
        </NotificationProvider>
      </LayoutProvider>
    </PermissionProvider>
  )
}

export function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

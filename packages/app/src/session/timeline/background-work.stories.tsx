import { BackgroundMoveHint } from "./message-timeline"

export default {
  title: "OpenCode/Session/Background work",
  id: "session-background-work",
  parameters: {
    docs: {
      description: {
        component: "Production control for moving blocking work to the background.",
      },
    },
  },
}

export const InlineMoveHint = {
  render: () => (
    <div class="flex w-[696px] max-w-full flex-col items-start gap-4">
      <BackgroundMoveHint keybind={["Ctrl", "B"]} />
    </div>
  ),
}

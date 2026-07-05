export function completeServerForm(reset: () => void, onExit?: () => void, action?: () => void) {
  reset()
  onExit?.()
  action?.()
}

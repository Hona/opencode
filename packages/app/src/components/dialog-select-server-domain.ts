export type ServerFormCallbacks = {
  onFormComplete?: () => void
  onFormInvalidated?: () => void
}

export function applyServerFormEvent(
  event: "complete" | "invalidated",
  reset: () => void,
  options: ServerFormCallbacks = {},
  action: () => void = () => {},
) {
  reset()
  action()
  if (event === "complete") options.onFormComplete?.()
  if (event === "invalidated") options.onFormInvalidated?.()
}

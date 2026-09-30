export function sessionPanelLayout(input: { side: boolean; dock: boolean; files: boolean }) {
  return {
    visible: input.side || input.dock || input.files,
    stacked: input.side && input.dock,
  }
}

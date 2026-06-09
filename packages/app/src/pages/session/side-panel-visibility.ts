export function shouldShowFileTree(input: { desktopV2: boolean; showFileTree: boolean; opened: boolean }) {
  return input.opened && (!input.desktopV2 || input.showFileTree)
}

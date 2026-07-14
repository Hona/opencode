export function tabsDrawerHasCloseButton(platform: "web" | "desktop", os?: "macos" | "windows" | "linux") {
  return platform !== "desktop" || os !== "windows"
}

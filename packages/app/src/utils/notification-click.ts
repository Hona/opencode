let nav: ((href: string) => void) | undefined
const pending: string[] = []

export const setNavigate = (fn: ((href: string) => void) | undefined) => {
  nav = fn
  if (!nav) return
  pending.splice(0).forEach(nav)
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  pending.push(href)
}

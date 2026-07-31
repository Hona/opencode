let nav: ((href: string) => void) | undefined
let pending: string | undefined

export const setNavigate = (fn: ((href: string) => void) | undefined) => {
  nav = fn
  if (!nav || pending === undefined) return
  const href = pending
  pending = undefined
  nav(href)
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  // Only the latest click matters if the router is not registered yet.
  pending = href
}

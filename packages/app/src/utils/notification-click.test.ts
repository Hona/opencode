import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("queues navigation until a navigate function is registered", () => {
    const calls: string[] = []
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual([])
    setNavigate((href) => calls.push(href))
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("keeps only the latest click while unregistered", () => {
    const calls: string[] = []
    handleNotificationClick("/abc/session/1")
    handleNotificationClick("/abc/session/2")
    setNavigate((href) => calls.push(href))
    expect(calls).toEqual(["/abc/session/2"])
  })
})

import { expect, test } from "bun:test"
import { resolveAddress } from "./address"
import { remember, suggest } from "./history"

test("the address field navigates to what reads as an address and searches for anything else", () => {
  const search = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`

  expect(
    [
      "",
      "https://example.com/a b",
      "about:blank",
      "localhost:3000",
      "localhost",
      "[::1]:5173/app",
      "127.0.0.1:8080",
      "dev-box:4096/health",
      "developer.mozilla.org/en-US/docs",
      "mdn",
      "css grid gap",
      "localhost 3000",
    ].map(resolveAddress),
  ).toEqual([
    "about:blank",
    "https://example.com/a b",
    "about:blank",
    "localhost:3000",
    "localhost",
    "[::1]:5173/app",
    "127.0.0.1:8080",
    "dev-box:4096/health",
    "developer.mozilla.org/en-US/docs",
    search("mdn"),
    search("css grid gap"),
    search("localhost 3000"),
  ])
})

test("history keeps one newest-first visit per URL and suggests addresses that complete the query first", () => {
  const visits = ["https://docs.example/mdn-guide", "https://developer.mozilla.org/", "https://www.mdn.dev/"].reduce(
    (list, url) => remember(list, { url, title: url.includes("mozilla") ? "MDN Web Docs" : "Other" }),
    remember([], { url: "https://developer.mozilla.org/", title: "Old title" }),
  )

  expect(visits.map((visit) => [visit.url, visit.title])).toEqual([
    ["https://www.mdn.dev/", "Other"],
    ["https://developer.mozilla.org/", "MDN Web Docs"],
    ["https://docs.example/mdn-guide", "Other"],
  ])
  // A leading www. and the scheme are not typed, so mdn completes www.mdn.dev; the others only contain it.
  expect(suggest(visits, "MDN", 5).map((visit) => visit.url)).toEqual([
    "https://www.mdn.dev/",
    "https://developer.mozilla.org/",
    "https://docs.example/mdn-guide",
  ])
  expect(suggest(visits, "  ", 5)).toEqual([])
  expect(
    Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`).reduce(
      (list, url) => remember(list, { url, title: "" }),
      visits,
    ),
  ).toHaveLength(30)
})

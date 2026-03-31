import { waitSessionIdle, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { createSdk } from "../utils"

const count = 14

function body(mark: string) {
  return [
    `title ${mark}`,
    `mark ${mark}`,
    ...Array.from({ length: 32 }, (_, i) => `line ${String(i + 1).padStart(2, "0")} ${mark}`),
  ]
}

function files(tag: string) {
  return Array.from({ length: count }, (_, i) => {
    const id = String(i).padStart(2, "0")
    return {
      file: `review-scroll-${id}.txt`,
      mark: `${tag}-${id}`,
    }
  })
}

function seed(list: ReturnType<typeof files>) {
  const out = ["*** Begin Patch"]

  for (const item of list) {
    out.push(`*** Add File: ${item.file}`)
    for (const line of body(item.mark)) out.push(`+${line}`)
  }

  out.push("*** End Patch")
  return out.join("\n")
}

function edit(file: string, prev: string, next: string) {
  return ["*** Begin Patch", `*** Update File: ${file}`, "@@", `-mark ${prev}`, `+mark ${next}`, "*** End Patch"].join(
    "\n",
  )
}

function paths(text: string) {
  return [...text.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((x) => x[1])
}

function issue(err: unknown) {
  if (!err || typeof err !== "object") return undefined
  if (!("name" in err) || !("data" in err)) return undefined
  const data = err.data
  if (!data || typeof data !== "object") return undefined
  return {
    name: typeof err.name === "string" ? err.name : undefined,
    message: "message" in data && typeof data.message === "string" ? data.message : undefined,
    status: "statusCode" in data && typeof data.statusCode === "number" ? data.statusCode : undefined,
  }
}

async function snap(sdk: ReturnType<typeof createSdk>, sessionID: string, want: string[]) {
  const [status, diff, items] = await Promise.all([
    sdk.session
      .status()
      .then((x) => x.data?.[sessionID]?.type ?? "idle")
      .catch((err) => `error:${err instanceof Error ? err.name : String(err)}`),
    sdk.session
      .diff({ sessionID })
      .then((x) => x.data ?? [])
      .catch(() => []),
    sdk.session
      .messages({ sessionID, limit: 50 })
      .then((x) => x.data ?? [])
      .catch(() => []),
  ])

  const seen = diff.filter((x) => want.includes(x.file)).map((x) => x.file)
  const msg = items.findLast((x) => x.info.role === "assistant" && !!x.info.error)
  const err = msg?.info.role === "assistant" ? issue(msg.info.error) : undefined

  return {
    status,
    diff: {
      count: diff.length,
      files: diff.slice(0, 10).map((x) => x.file),
      seen,
      missing: want.filter((x) => !seen.includes(x)),
    },
    error: err,
  }
}

function brief(list: Array<Record<string, unknown>>) {
  return list
    .map((x) => {
      const data = "data" in x && x.data && typeof x.data === "object" ? x.data : undefined
      const diff = data && "diff" in data && data.diff && typeof data.diff === "object" ? data.diff : undefined
      const err = data && "error" in data && data.error && typeof data.error === "object" ? data.error : undefined
      return [
        `attempt=${x.attempt}`,
        `busy=${x.busy}`,
        `idle=${x.idle}`,
        `first=${x.first}`,
        `late=${x.late}`,
        `next=${x.next}`,
        `diff=${diff && "count" in diff ? diff.count : "?"}`,
        `seen=${diff && "seen" in diff && Array.isArray(diff.seen) ? diff.seen.join(",") : ""}`,
        `err=${err && "name" in err && typeof err.name === "string" ? err.name : "none"}`,
      ].join(" ")
    })
    .join("\n")
}

async function waitSessionBusy(sdk: ReturnType<typeof createSdk>, sessionID: string, timeout = 5_000) {
  await expect
    .poll(
      () =>
        sdk.session
          .status()
          .then((x) => x.data?.[sessionID]?.type ?? "idle")
          .catch(() => "idle"),
      { timeout },
    )
    .not.toBe("idle")
}

async function waitProbe(probe: () => Promise<boolean | undefined>, timeout = 5_000) {
  return expect
    .poll(
      () =>
        probe()
          .then((x) => Boolean(x))
          .catch(() => false),
      { timeout },
    )
    .toBe(true)
    .then(() => true)
    .catch(() => false)
}

async function patch(
  sdk: ReturnType<typeof createSdk>,
  sessionID: string,
  patchText: string,
  probe: () => Promise<boolean | undefined>,
) {
  const want = paths(patchText)
  const list: Array<Record<string, unknown>> = []

  for (let i = 0; i < 3; i++) {
    const step: Record<string, unknown> = {
      attempt: i + 1,
      abort: Boolean(i),
    }
    list.push(step)

    if (i) {
      await sdk.session.abort({ sessionID }).catch(() => undefined)
      step.drain = await waitSessionIdle(sdk, sessionID, 30_000)
        .then(() => true)
        .catch(() => false)
    }

    await sdk.session.promptAsync({
      sessionID,
      agent: "build",
      system: [
        "You are seeding deterministic e2e UI state.",
        "Your only valid response is one apply_patch tool call.",
        `Use this JSON input: ${JSON.stringify({ patchText })}`,
        "Do not call any other tools.",
        "Do not output plain text.",
      ].join("\n"),
      parts: [{ type: "text", text: "Apply the provided patch exactly once." }],
    })

    const first = await probe().catch(() => undefined)
    step.first = Boolean(first)

    const busy = await waitSessionBusy(sdk, sessionID)
      .then(() => true)
      .catch(() => false)
    step.busy = busy

    if (!busy) {
      if (first) return

      const late = await waitProbe(probe)
      step.late = late
      step.data = await snap(sdk, sessionID, want)
      if (late) return
      continue
    }

    const idle = await waitSessionIdle(sdk, sessionID, 45_000)
      .then(() => true)
      .catch(() => false)
    step.idle = idle

    if (!idle) continue

    const next = await waitProbe(probe, 10_000)
    step.next = next
    step.data = await snap(sdk, sessionID, want)

    if (next) return
  }

  const body = JSON.stringify(
    {
      sessionID,
      want,
      attempts: list,
    },
    null,
    2,
  )
  await test.info().attach("seed-trace", {
    body,
    contentType: "application/json",
  })

  throw new Error(["Timed out seeding patch", brief(list)].join("\n"))
}

async function show(page: Parameters<typeof test>[0]["page"]) {
  const btn = page.getByRole("button", { name: "Toggle review" }).first()
  await expect(btn).toBeVisible()
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click()
  await expect(btn).toHaveAttribute("aria-expanded", "true")
}

async function expand(page: Parameters<typeof test>[0]["page"]) {
  const close = page.getByRole("button", { name: /^Collapse all$/i }).first()
  const open = await close
    .isVisible()
    .then((value) => value)
    .catch(() => false)

  const btn = page.getByRole("button", { name: /^Expand all$/i }).first()
  if (open) {
    await close.click()
    await expect(btn).toBeVisible()
  }

  await expect(btn).toBeVisible()
  await btn.click()
  await expect(close).toBeVisible()
}

async function waitMark(page: Parameters<typeof test>[0]["page"], file: string, mark: string) {
  await page.waitForFunction(
    ({ file, mark }) => {
      const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
      if (!(view instanceof HTMLElement)) return false

      const head = Array.from(view.querySelectorAll("h3")).find(
        (node) => node instanceof HTMLElement && node.textContent?.includes(file),
      )
      if (!(head instanceof HTMLElement)) return false

      return Array.from(head.parentElement?.querySelectorAll("diffs-container") ?? []).some((host) => {
        if (!(host instanceof HTMLElement)) return false
        const root = host.shadowRoot
        return root?.textContent?.includes(`mark ${mark}`) ?? false
      })
    },
    { file, mark },
    { timeout: 60_000 },
  )
}

async function spot(page: Parameters<typeof test>[0]["page"], file: string) {
  return page.evaluate((file) => {
    const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
    if (!(view instanceof HTMLElement)) return null

    const row = Array.from(view.querySelectorAll("h3")).find(
      (node) => node instanceof HTMLElement && node.textContent?.includes(file),
    )
    if (!(row instanceof HTMLElement)) return null

    const a = row.getBoundingClientRect()
    const b = view.getBoundingClientRect()
    return {
      top: a.top - b.top,
      y: view.scrollTop,
    }
  }, file)
}

async function comment(page: Parameters<typeof test>[0]["page"], file: string, note: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  await expect(row).toBeVisible()

  const line = row.locator('diffs-container [data-line="2"]').first()
  await expect(line).toBeVisible()
  await line.hover()

  const add = row.getByRole("button", { name: /^Comment$/ }).first()
  await expect(add).toBeVisible()
  await add.click()

  const area = row.locator('[data-slot="line-comment-textarea"]').first()
  await expect(area).toBeVisible()
  await area.fill(note)

  const submit = row.locator('[data-slot="line-comment-action"][data-variant="primary"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(row.locator('[data-slot="line-comment-content"]').filter({ hasText: note }).first()).toBeVisible()
  await expect(row.locator('[data-slot="line-comment-tools"]').first()).toBeVisible()
}

async function overflow(page: Parameters<typeof test>[0]["page"], file: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  const view = page.locator('[data-slot="session-review-scroll"] .scroll-view__viewport').first()
  const pop = row.locator('[data-slot="line-comment-popover"][data-inline-body]').first()
  const tools = row.locator('[data-slot="line-comment-tools"]').first()

  const [width, viewBox, popBox, toolsBox] = await Promise.all([
    view.evaluate((el) => el.scrollWidth - el.clientWidth),
    view.boundingBox(),
    pop.boundingBox(),
    tools.boundingBox(),
  ])

  if (!viewBox || !popBox || !toolsBox) return null

  return {
    width,
    pop: popBox.x + popBox.width - (viewBox.x + viewBox.width),
    tools: toolsBox.x + toolsBox.width - (viewBox.x + viewBox.width),
  }
}

async function openReviewFile(page: Parameters<typeof test>[0]["page"], file: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  await expect(row).toBeVisible()
  await row.hover()

  const open = row.getByRole("button", { name: /^Open file$/i }).first()
  await expect(open).toBeVisible()
  await open.click()

  const tab = page.getByRole("tab", { name: file }).first()
  await expect(tab).toBeVisible()
  await tab.click()

  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()
  return viewer
}

async function fileComment(page: Parameters<typeof test>[0]["page"], note: string) {
  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()

  const line = viewer.locator('diffs-container [data-line="2"]').first()
  await expect(line).toBeVisible()
  await line.hover()

  const add = viewer.getByRole("button", { name: /^Comment$/ }).first()
  await expect(add).toBeVisible()
  await add.click()

  const area = viewer.locator('[data-slot="line-comment-textarea"]').first()
  await expect(area).toBeVisible()
  await area.fill(note)

  const submit = viewer.locator('[data-slot="line-comment-action"][data-variant="primary"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(viewer.locator('[data-slot="line-comment-content"]').filter({ hasText: note }).first()).toBeVisible()
  await expect(viewer.locator('[data-slot="line-comment-tools"]').first()).toBeVisible()
}

async function fileOverflow(page: Parameters<typeof test>[0]["page"]) {
  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  const view = page.locator('[role="tabpanel"] .scroll-view__viewport').first()
  const pop = viewer.locator('[data-slot="line-comment-popover"][data-inline-body]').first()
  const tools = viewer.locator('[data-slot="line-comment-tools"]').first()

  const [width, viewBox, popBox, toolsBox] = await Promise.all([
    view.evaluate((el) => el.scrollWidth - el.clientWidth),
    view.boundingBox(),
    pop.boundingBox(),
    tools.boundingBox(),
  ])

  if (!viewBox || !popBox || !toolsBox) return null

  return {
    width,
    pop: popBox.x + popBox.width - (viewBox.x + viewBox.width),
    tools: toolsBox.x + toolsBox.width - (viewBox.x + viewBox.width),
  }
}

test("review applies inline comment clicks without horizontal overflow", async ({ page, withProject }) => {
  test.setTimeout(180_000)

  const tag = `review-comment-${Date.now()}`
  const file = `review-comment-${tag}.txt`
  const note = `comment ${tag}`

  await page.setViewportSize({ width: 1280, height: 900 })

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e review comment ${tag}`, async (session) => {
      await patch(sdk, session.id, seed([{ file, mark: tag }]), async () => {
        const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
        return diff.some(
          (item) => item.file === file && typeof item.after === "string" && item.after.includes(`mark ${tag}`),
        )
          ? true
          : undefined
      })

      await project.gotoSession(session.id)
      await show(page)

      const tab = page.getByRole("tab", { name: /Review/i }).first()
      await expect(tab).toBeVisible()
      await tab.click()

      await expand(page)
      await waitMark(page, file, tag)
      await comment(page, file, note)

      await expect
        .poll(async () => (await overflow(page, file))?.width ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
      await expect
        .poll(async () => (await overflow(page, file))?.pop ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
      await expect
        .poll(async () => (await overflow(page, file))?.tools ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
    })
  })
})

test("review file comments submit on click without clipping actions", async ({ page, withProject }) => {
  test.setTimeout(180_000)

  const tag = `review-file-comment-${Date.now()}`
  const file = `review-file-comment-${tag}.txt`
  const note = `comment ${tag}`

  await page.setViewportSize({ width: 1280, height: 900 })

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e review file comment ${tag}`, async (session) => {
      await patch(sdk, session.id, seed([{ file, mark: tag }]), async () => {
        const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
        return diff.some(
          (item) => item.file === file && typeof item.after === "string" && item.after.includes(`mark ${tag}`),
        )
          ? true
          : undefined
      })

      await project.gotoSession(session.id)
      await show(page)

      const tab = page.getByRole("tab", { name: /Review/i }).first()
      await expect(tab).toBeVisible()
      await tab.click()

      await expand(page)
      await waitMark(page, file, tag)
      await openReviewFile(page, file)
      await fileComment(page, note)

      await expect
        .poll(async () => (await fileOverflow(page))?.width ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
      await expect
        .poll(async () => (await fileOverflow(page))?.pop ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
      await expect
        .poll(async () => (await fileOverflow(page))?.tools ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
        .toBeLessThanOrEqual(1)
    })
  })
})

test("review keeps scroll position after a live diff update", async ({ page, withProject }) => {
  test.skip(Boolean(process.env.CI), "Flaky in CI for now.")
  test.setTimeout(180_000)

  const tag = `review-${Date.now()}`
  const list = files(tag)
  const hit = list[list.length - 4]!
  const next = `${tag}-live`

  await page.setViewportSize({ width: 1600, height: 1000 })

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e review ${tag}`, async (session) => {
      await patch(sdk, session.id, seed(list), async () => {
        const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
        return list.every((item) =>
          diff.some(
            (entry) =>
              entry.file === item.file && typeof entry.after === "string" && entry.after.includes(`mark ${item.mark}`),
          ),
        )
          ? true
          : undefined
      })

      await expect
        .poll(
          async () => {
            const info = await sdk.session.get({ sessionID: session.id }).then((res) => res.data)
            return info?.summary?.files ?? 0
          },
          { timeout: 60_000 },
        )
        .toBe(list.length)

      await project.gotoSession(session.id)
      await show(page)

      const tab = page.getByRole("tab", { name: /Review/i }).first()
      await expect(tab).toBeVisible()
      await tab.click()

      const view = page.locator('[data-slot="session-review-scroll"] .scroll-view__viewport').first()
      await expect(view).toBeVisible()
      const heads = page.getByRole("heading", { level: 3 }).filter({ hasText: /^review-scroll-/ })
      await expect(heads).toHaveCount(list.length, {
        timeout: 60_000,
      })

      await expand(page)
      await waitMark(page, hit.file, hit.mark)

      const row = page
        .getByRole("heading", { level: 3, name: new RegExp(hit.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
        .first()
      await expect(row).toBeVisible()
      await row.evaluate((el) => el.scrollIntoView({ block: "center" }))

      await expect.poll(async () => (await spot(page, hit.file))?.y ?? 0).toBeGreaterThan(200)
      const prev = await spot(page, hit.file)
      if (!prev) throw new Error(`missing review row for ${hit.file}`)

      await patch(sdk, session.id, edit(hit.file, hit.mark, next), async () => {
        const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
        const item = diff.find((item) => item.file === hit.file)
        return typeof item?.after === "string" && item.after.includes(`mark ${next}`) ? true : undefined
      })

      await waitMark(page, hit.file, next)

      await expect
        .poll(
          async () => {
            const next = await spot(page, hit.file)
            if (!next) return Number.POSITIVE_INFINITY
            return Math.max(Math.abs(next.top - prev.top), Math.abs(next.y - prev.y))
          },
          { timeout: 60_000 },
        )
        .toBeLessThanOrEqual(32)
    })
  })
})

import { describe, test, expect, afterEach, spyOn } from "bun:test"
import { Terminal, Ghostty } from "ghostty-web"
import { SerializeAddon } from "./serialize"

const ghostty = await Ghostty.load()

const terminals: Terminal[] = []

afterEach(() => {
  for (const term of terminals) {
    term.dispose()
  }
  terminals.length = 0
  document.body.innerHTML = ""
})

function createTerminal(cols = 80, rows = 24): { term: Terminal; addon: SerializeAddon; container: HTMLElement } {
  const container = document.createElement("div")
  document.body.appendChild(container)

  const term = new Terminal({ cols, rows, ghostty })
  const addon = new SerializeAddon()
  term.loadAddon(addon)
  term.open(container)
  terminals.push(term)

  return { term, addon, container }
}

function writeAndWait(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}

describe("SerializeAddon", () => {
  test("scrollback reads only the requested tail and restores the cursor on its screen row", async () => {
    const { term, addon } = createTerminal(20, 5)
    await writeAndWait(term, Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\r\n"))
    await writeAndWait(term, "\x1b[2A\x1b[3G")
    expect(term.buffer.normal.length).toBe(30)
    expect([term.buffer.normal.cursorX, term.buffer.normal.cursorY]).toEqual([2, 2])

    const reads = spyOn(term.buffer.normal, "getLine")
    const serialized = addon.serialize({ scrollback: 3 })
    expect(new Set(reads.mock.calls.map((args) => args[0]))).toEqual(new Set([22, 23, 24, 25, 26, 27, 28, 29]))
    reads.mockRestore()

    const restored = createTerminal(20, 5)
    await writeAndWait(restored.term, serialized)
    expect(restored.term.getScrollbackLength()).toBe(3)
    for (let row = 0; row < 8; row++) {
      expect(restored.term.buffer.normal.getLine(row)?.translateToString(true)).toBe(`line ${22 + row}`)
    }
    expect([restored.term.buffer.normal.cursorX, restored.term.buffer.normal.cursorY]).toEqual([2, 2])
  })

  test("preserves color scheme reporting mode", async () => {
    const { term, addon } = createTerminal()
    await writeAndWait(term, "\x1b[?2031h")

    expect(addon.serialize().startsWith("\x1b[?2031h")).toBe(true)
    expect(addon.serialize({ excludeModes: true }).startsWith("\x1b[?2031h")).toBe(false)
  })

  describe("round-trip serialization", () => {
    test("multi-line content should not have garbage characters", async () => {
      const { term, addon } = createTerminal()

      const content = [
        "\x1b[1;32m❯\x1b[0m \x1b[34mcd\x1b[0m /some/path",
        "\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m -la",
        "total 42",
      ].join("\r\n")

      await writeAndWait(term, content)

      const serialized = addon.serialize()

      expect(/\x1b\[\d+X/.test(serialized)).toBe(false)

      const { term: term2 } = createTerminal()
      terminals.push(term2)
      await writeAndWait(term2, serialized)

      for (let row = 0; row < 3; row++) {
        const line = term2.buffer.active.getLine(row)?.translateToString(true)
        expect(line?.includes("𑼝")).toBe(false)
      }

      expect(term2.buffer.active.getLine(0)?.translateToString(true)).toContain("cd /some/path")
      expect(term2.buffer.active.getLine(1)?.translateToString(true)).toContain("ls -la")
      expect(term2.buffer.active.getLine(2)?.translateToString(true)).toBe("total 42")
    })

    test("alternate buffer should round-trip without garbage", async () => {
      const { term, addon } = createTerminal(20, 5)

      await writeAndWait(term, "normal\r\n")
      await writeAndWait(term, "\x1b[?1049h\x1b[HALT")

      expect(term.buffer.active.type).toBe("alternate")

      const serialized = addon.serialize()

      const { term: term2 } = createTerminal(20, 5)
      terminals.push(term2)
      await writeAndWait(term2, serialized)

      expect(term2.buffer.active.type).toBe("alternate")

      const line = term2.buffer.active.getLine(0)
      expect(line?.translateToString(true)).toBe("ALT")

      // Ensure a cell beyond content isn't garbage
      const cellCode = line?.getCell(10)?.getCode()
      expect(cellCode === 0 || cellCode === 32).toBe(true)
    })

    test("serialized output written to new terminal should match original colors", async () => {
      const { term, addon } = createTerminal(40, 5)

      const input = "\x1b[38;2;255;0;0mHello\x1b[0m \x1b[38;2;0;255;0mWorld\x1b[0m!                            "
      await writeAndWait(term, input)

      const origLine = term.buffer.active.getLine(0)
      const origHelloFg = origLine!.getCell(0)!.getFgColor()
      const origWorldFg = origLine!.getCell(6)!.getFgColor()

      const serialized = addon.serialize({ range: { start: 0, end: 0 } })

      const { term: term2 } = createTerminal(40, 5)
      terminals.push(term2)
      await writeAndWait(term2, serialized)

      const newLine = term2.buffer.active.getLine(0)

      expect(newLine!.getCell(0)!.getChars()).toBe("H")
      expect(newLine!.getCell(0)!.getFgColor()).toBe(origHelloFg)

      expect(newLine!.getCell(6)!.getChars()).toBe("W")
      expect(newLine!.getCell(6)!.getFgColor()).toBe(origWorldFg)

      expect(newLine!.getCell(11)!.getChars()).toBe("!")
    })
  })
})

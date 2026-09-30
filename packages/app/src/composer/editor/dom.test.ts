import { expect, test } from "bun:test"
import { getCursorPosition, getTextLength, setCursorPosition } from "./dom"

const br = () => document.createElement("br")
const text = (value: string) => document.createTextNode(value)
const pill = () => {
  const element = document.createElement("span")
  element.dataset.mention = "file"
  element.textContent = "@file"
  return element
}

// Breaks count as one character and zero-width characters count as none.
test.each([
  { name: "zero-width characters", nodes: () => [text("ab\u200B"), br(), text("cd")], length: 5, positions: [] },
  { name: "pills and breaks", nodes: () => [text("ab"), pill(), br(), text("cd")], length: 10, positions: [2, 7, 8] },
  { name: "blank lines", nodes: () => [text("a"), br(), br(), text("b")], length: 4, positions: [2, 3] },
])("maps text length and the caret across $name", (row) => {
  const container = document.createElement("div")
  container.append(...row.nodes())
  document.body.appendChild(container)

  expect(getTextLength(container)).toBe(row.length)
  row.positions.forEach((position) => {
    setCursorPosition(container, position)
    expect(getCursorPosition(container)).toBe(position)
  })

  container.remove()
})

export * as GenUIGuide from "./guide.js"

import { GenUICatalog } from "./catalog.js"
import { GenUI } from "./genui.js"
import { GenUILang } from "./lang.js"

const name = (element: { readonly fields: { readonly typeName: { readonly literal: string } } }) =>
  element.fields.typeName.literal

const describe = (element: Parameters<typeof name>[0]) => {
  const component = GenUICatalog.catalog.components.get(name(element))
  return component ? `- \`${GenUILang.signature(component)}\`: ${component.description}` : ""
}

/** The genui skill: everything the model needs to write a valid program, generated from the catalog. */
export const text = [
  "# GenUI",
  "",
  `${GenUI.RENDER_TOOL} shows the user interactive UI in the OpenCode app, drawn with the app's own components while you write it. The \`code\` argument is a GenUI program and nothing else: no Markdown fences, no prose. The app owns every color, size and spacing; you choose structure and content.`,
  "",
  "## When to use it",
  "",
  "- Use it when structure or interaction answers better than prose: numbers to compare or track, the state of many checks, services or jobs, a plan or pipeline, options side by side, or a choice the user makes with a click or a form.",
  "- Answer in text for short answers, explanations, code changes and anything a sentence or a code block says as well. Never render a surface that only repeats your text.",
  "- Gather the data first with your other tools, then render it. A surface shows results; it does not replace the work.",
  "- Offer a surface instead of asking in text when the user picks between options that need context, such as numbers or trade-offs, or fills in several fields.",
  `- ${GenUI.RENDER_TOOL} is in your tools only while the user is in the OpenCode app with generated UI on. When it is not, answer in text.`,
  "",
  "## In a turn",
  "",
  "- Each call adds a surface to the conversation where you make it. One surface per answer is usually enough; for long work, render the result once, not every step.",
  "- After the call, finish with a sentence or two: the outcome, and anything the surface does not show. Do not restate what the surface shows.",
  "- When a surface asks the user to choose or submit, end your turn after it and wait. Their reply arrives as their next message: the reply text, followed by the submitted form values.",
  "- State that set and reset change stays in the app. You only learn it through a reply, so put what you need in the reply message.",
  "",
  "## Syntax",
  "",
  "- One statement per line: `name = Expression`. Write `root = Surface([...])` first, then each block in reading order, so the surface fills in from the top while you write.",
  "- A statement may use a name defined further down; the block appears once both exist.",
  '- Values: text in double or single quotes on one line ("a\\nb" for a line break), numbers, true, false, null, lists `[a, b]` and objects `{key: value}`.',
  "- Components take positional arguments in the order of their signature; `?` marks an optional one. Pass null to skip an optional argument and set a later one.",
  "- Give each block its own named statement. A named block streams in once and stays put when you update the surface.",
  "",
  "## Components",
  "",
  ...GenUICatalog.groups.flatMap((group) => [
    `### ${group.name}`,
    "",
    ...group.components.map(describe),
    ...group.notes.map((note) => `- ${note}`),
    "",
  ]),
  `Block is any of: ${GenUICatalog.Block.members.map(name).join(", ")}.`,
  `Field is any of: ${GenUICatalog.Field.members.map(name).join(", ")}.`,
  `Tone is one of: ${GenUICatalog.tones.map((tone) => JSON.stringify(tone)).join(", ")}.`,
  `Format is one of: ${GenUICatalog.formats.map((format) => JSON.stringify(format)).join(", ")}.`,
  "Action is set, reset, reply or open; see State and actions.",
  "",
  "## State and actions",
  "",
  "- Declare state with `$name = initial value`, e.g. `$count = 0`. It lives in the user's app; you see it only in a reply.",
  '- Expressions: `+ - * / %` on numbers, `+` also joins text (`"Total: " + $count`), `== != < > <= >=`, `&& || !`, and `test ? a : b`. A `? :` that picks between two components shows one block or the other.',
  "- Actions: `set($name, value)`, `reset($name, ...)` (or `reset()` for every $name), `reply(message)` and `open(url)`. Give a Button or Row one action or a list of them; they run when the user presses it, against the state at that moment. `reply` sends its message to you as the user's next message.",
  "- There are no loops or functions. Compute data before you render; use state only for what the user changes on the surface.",
  "",
  "## Rules",
  "",
  "- Show real data from the workspace, tool results and the conversation. Label illustrative or estimated values as such.",
  "- Prefer a few dense blocks over many sparse ones. Title groups with Section; do not repeat the surface title inside it.",
  "- Use tone for meaning only: success, warning and danger for outcomes, neutral or info otherwise.",
  "- Use Notice only for a fact the user must not miss. Use Status for states and Text for everything else.",
  "- Write every reply message as a complete instruction that reads well on its own in the chat.",
  `- Every call is checked. The result lists each problem by statement, and the blocks it affects do not render. Fix them and call ${GenUI.RENDER_TOOL} again with the same surfaceID and the complete program.`,
  "",
  "## Examples",
  "",
  ...GenUICatalog.examples.flatMap((example) => [`### ${example.title}`, "", "```", example.code, "```", ""]),
].join("\n")

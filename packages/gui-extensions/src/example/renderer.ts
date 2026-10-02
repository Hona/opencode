import { Command, createKeyed, TitlebarItem, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const pill = ctx.stores.pill

  // #region toggle
  // Needs no main process: it only flips a stored preference.
  ctx.add(Command, {
    id: "toggle",
    get title() {
      return ctx.t(pill.value.shown ? "command.hide" : "command.show")
    },
    run: () => pill.update((draft) => ({ shown: !draft.shown })),
  })
  // #endregion

  // #region counter
  // One run per generation of main's counter. What it adds goes away with the generation, so nothing is offered
  // while the counter cannot answer (on the web, always).
  createKeyed(ctx.uses.counter, (counter) => {
    ctx.add(TitlebarItem, () =>
      pill.value.shown
        ? {
            id: "count",
            label: ctx.plural("pill.label", counter.state() ?? 0),
            title: ctx.t("pill.title"),
            icon: "plus",
            run: () => void counter.add(1, { signal: ctx.signal }),
          }
        : undefined,
    )
    ctx.add(Command, {
      id: "reset",
      get title() {
        return ctx.t("command.reset")
      },
      run: () => counter.reset(undefined, { signal: ctx.signal }),
    })
  })
  // #endregion
}

export default setup

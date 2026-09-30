import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  id: "wsl",
  os: ["windows"],
  i18n: { en },
})

import { Extension } from "../sdk"
import { Pairing } from "./contract"
import en from "./i18n/en"

export default Extension.define({
  id: "pairing",
  provides: { pairing: Pairing },
  uses: { pairing: Pairing },
  i18n: { en },
})

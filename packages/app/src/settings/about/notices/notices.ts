import apache from "./apache-2.0.txt?raw"
import betterOfficeNotice from "./betteroffice-notice.txt?raw"
import caladea from "./ofl-caladea.txt?raw"
import carlito from "./ofl-carlito.txt?raw"
import liberation from "./ofl-liberation.txt?raw"

/**
 * Third-party software that ships inside the app, with the attribution its license asks redistributions to carry.
 * Notices and license texts are reproduced verbatim from each project, so they are not translated.
 */
export const notices = [
  {
    name: "BetterOffice",
    detail: "@betteroffice/docx, @betteroffice/xlsx, @betteroffice/pptx, @betteroffice/fonts",
    url: "https://github.com/openooxml/betteroffice",
    license: "Apache License 2.0",
    notice: `${betterOfficeNotice.trim()}\nCopyright 2026 The OpenOOXML contributors`,
    text: apache,
  },
  {
    name: "eigenpal docx editor",
    detail: "Portions of BetterOffice derive from it.",
    url: "https://github.com/eigenpal/docx-editor",
    license: "Apache License 2.0",
    notice: "Copyright 2026 EigenPal Inc.",
    text: apache,
  },
  {
    name: "Carlito",
    detail: "Font",
    url: "https://github.com/googlefonts/carlito",
    license: "SIL Open Font License 1.1",
    notice: undefined,
    text: carlito,
  },
  {
    name: "Caladea",
    detail: "Font",
    url: "https://github.com/huertatipografica/Caladea",
    license: "SIL Open Font License 1.1",
    notice: undefined,
    text: caladea,
  },
  {
    name: "Liberation Fonts",
    detail: "Liberation Sans, Liberation Serif, Liberation Mono",
    url: "https://github.com/liberationfonts/liberation-fonts",
    license: "SIL Open Font License 1.1",
    notice: undefined,
    text: liberation,
  },
] as const

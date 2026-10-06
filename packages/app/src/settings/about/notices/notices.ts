import apache from "./apache-2.0.txt?raw"
import betterOfficeNotice from "./betteroffice-notice.txt?raw"
import { crates, crateTexts } from "./crates"
import caladea from "./fonts/OFL-Caladea.txt?raw"
import carlito from "./fonts/OFL-Carlito.txt?raw"
import comicRelief from "./fonts/OFL-ComicRelief.txt?raw"
import dmSans from "./fonts/OFL-DMSans.txt?raw"
import dmSerifDisplay from "./fonts/OFL-DMSerifDisplay.txt?raw"
import gelasio from "./fonts/OFL-Gelasio.txt?raw"
import heebo from "./fonts/OFL-Heebo.txt?raw"
import inter from "./fonts/OFL-Inter.txt?raw"
import liberation from "./fonts/OFL-Liberation.txt?raw"
import montserrat from "./fonts/OFL-Montserrat.txt?raw"
import notoArabic from "./fonts/OFL-NotoArabic.txt?raw"
import notoSansHebrew from "./fonts/OFL-NotoSansHebrew.txt?raw"
import openSans from "./fonts/OFL-OpenSans.txt?raw"
import oswald from "./fonts/OFL-Oswald.txt?raw"
import poppins from "./fonts/OFL-Poppins.txt?raw"
import roboto from "./fonts/OFL-Roboto.txt?raw"
import sourceSans3 from "./fonts/OFL-SourceSans3.txt?raw"

const ofl = "SIL Open Font License 1.1"

/** A font the Office previews ship; its license file opens with the font's copyright notice. */
const font = (name: string, url: string, text: string) => ({
  name,
  detail: undefined,
  detailKey: "settings.about.notices.font" as const,
  url,
  license: ofl,
  notice: undefined,
  text,
})

/**
 * Third-party software that ships inside the app, with the attribution its license asks redistributions to carry.
 * Notices and license texts are reproduced verbatim from each project, so they are not translated.
 */
export const notices = [
  {
    name: "BetterOffice",
    detail: "@betteroffice/docx, @betteroffice/xlsx, @betteroffice/pptx, @betteroffice/fonts",
    detailKey: undefined,
    url: "https://github.com/openooxml/betteroffice",
    license: "Apache License 2.0",
    notice: `${betterOfficeNotice.trim()}\nCopyright 2026 The OpenOOXML contributors`,
    text: apache,
  },
  {
    name: "eigenpal docx editor",
    detail: undefined,
    detailKey: "settings.about.notices.eigenpal" as const,
    url: "https://github.com/eigenpal/docx-editor",
    license: "Apache License 2.0",
    notice: "Copyright 2026 EigenPal Inc.",
    text: apache,
  },
  font("Carlito", "https://github.com/googlefonts/carlito", carlito),
  font("Caladea", "https://github.com/huertatipografica/Caladea", caladea),
  font("Liberation Fonts", "https://github.com/liberationfonts/liberation-fonts", liberation),
  font("Gelasio", "https://github.com/SorkinType/Gelasio", gelasio),
  font("Comic Relief", "https://github.com/loudifier/Comic-Relief", comicRelief),
  font("Inter", "https://github.com/rsms/inter", inter),
  font("Roboto", "https://github.com/googlefonts/roboto-classic", roboto),
  font("Source Sans 3", "https://github.com/adobe-fonts/source-sans", sourceSans3),
  font("DM Sans", "https://github.com/googlefonts/dm-fonts", dmSans),
  font("DM Serif Display", "https://github.com/googlefonts/dm-fonts", dmSerifDisplay),
  font("Open Sans", "https://github.com/googlefonts/opensans", openSans),
  font("Montserrat", "https://github.com/JulietaUla/Montserrat", montserrat),
  font("Poppins", "https://github.com/itfoundry/Poppins", poppins),
  font("Oswald", "https://github.com/googlefonts/OswaldFont", oswald),
  font("Heebo", "https://github.com/OdedEzer/heebo", heebo),
  font("Noto Sans Arabic, Noto Naskh Arabic", "https://github.com/notofonts/arabic", notoArabic),
  font("Noto Sans Hebrew", "https://github.com/notofonts/hebrew", notoSansHebrew),
]

/**
 * The Rust crates the BetterOffice wasm engines compile in, generated from the published Cargo.lock and crate
 * tarballs. Each crate keeps its own copyright lines; license texts are stored once and referenced by id.
 */
export const crateNotices = {
  crates,
  texts: [...crateTexts, { id: "apache-2.0", license: "Apache-2.0", title: "Apache License 2.0", text: apache }],
}

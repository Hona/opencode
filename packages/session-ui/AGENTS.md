## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy through `i18n.plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `i18n.t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change.
- NEVER change existing English text or English keys to facilitate translation. English is intentional, designer-written source copy; adapt locale-specific translations and i18n mechanics around it.
- Do not translate from model knowledge alone. Verify terminology and grammar with Unicode CLDR locale/plural data, Microsoft Localization Style Guides and terminology, Apple localization/style guidance and localized platform UI, Mozilla localization style guides, Mozilla Pontoon, and the Firefox localization corpus at `github.com/mozilla-l10n/firefox-l10n`.
- Also use the relevant language authority or official dictionary for the locale (for example RAE/Fundéu, FranceTerme, Duden, TDK, Kotus/Kielitoimiston sanakirja, Språkrådet/Bokmålsordboka, Rada Języka Polskiego/PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, or the Royal Society of Thailand). Treat the English dictionary as the semantic source of truth and preserve placeholders, code identifiers, product names, and keyboard labels.

## Typography Clipping

- Inter glyph ink extends outside solid line boxes such as `13px / 13px`. Truncation and `overflow: hidden` can clip descenders even when the text fits horizontally.
- Keep transcript row geometry unchanged. For intrinsic-height text, use equal block padding and negative block margin on the clipping element to provide paint space. Use a larger line height only inside an already fixed-height control.
- `TextShimmer` inherits font metrics, so put typography overrides on its parent. Verify `g`, `j`, `p`, `q`, and `y` at supported device scale factors when changing tool, notice, or truncation CSS.

## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for component defaults, visible copy, placeholders, accessible labels, tooltips, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy through `plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change.
- NEVER change existing English text or English keys to facilitate translation. English is intentional, designer-written source copy; adapt locale-specific translations and i18n mechanics around it.
- Do not translate from model knowledge alone. Verify terminology and grammar with Unicode CLDR locale/plural data, Microsoft Localization Style Guides and terminology, Apple localization/style guidance and localized platform UI, Mozilla localization style guides, Mozilla Pontoon, and the Firefox localization corpus at `github.com/mozilla-l10n/firefox-l10n`.
- For developer-facing terminology, prefer established usage in the target language's developer community over literal translations. Cross-check maintained Firefox, KDE, and VS Code localizations, using at least two independent corpora when available. Keep established English loanwords and acronyms instead of inventing unfamiliar terms.
- Translate whole UI phrases in context rather than substituting glossary words. Audit recurring concepts for consistency and review every exact-English value; retain it only when it is an intentional product/provider/tool name, URL, code token, keyboard legend, acronym, asset name, or established borrowing.
- Record the corpora used and flag uncertain or regional terminology in review notes.
- Also use the relevant language authority or official dictionary for the locale (for example RAE/Fundéu, FranceTerme, Duden, TDK, Kotus/Kielitoimiston sanakirja, Språkrådet/Bokmålsordboka, Rada Języka Polskiego/PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, or the Royal Society of Thailand). Treat the English dictionary as the semantic source of truth and preserve placeholders, code identifiers, product names, and keyboard labels.

## Typography Clipping

- Inter glyph ink extends outside solid line boxes such as `13px / 13px`. Any text element or ancestor using `overflow: hidden`, `overflow: clip`, or truncation can cut off descenders such as `g`, `j`, `p`, `q`, and `y`.
- Preserve layout geometry when fixing clipping. On intrinsic-height text, expand the clipping element's paint area with equal block padding and negative block margin instead of increasing its line height. For fixed-height controls, a safe line height is acceptable only when the outer dimensions remain unchanged.
- `TextShimmer` uses inherited font metrics. Put font size, weight, tracking, and line height on its parent when those values must override the component defaults.
- Test clipping changes with descenders at the supported device scale factors. Do not use transforms or one-sided positional offsets as font-specific compensation.

---
description: sync one product app locale from English
---

Translate the product app locale `$1` from the English source dictionaries. English is the source of truth.

The translation request below contains the locale glossary, exact source and target files, plus missing, extra, and placeholder-mismatched keys. When invoked manually with only a locale, derive the same information by comparing its app, UI, and existing desktop dictionaries with their `en.ts` files.

```json
$ARGUMENTS
```

Requirements:

- Edit only the target files listed in the request. Never edit English, another locale, tests, registries, docs, or other packages.
- Add every missing key with a natural, concise translation suitable for application UI.
- Remove keys listed as extra and repair values listed under `placeholders` so their `{{tokens}}` exactly match English.
- Preserve existing translations unless they have a listed placeholder mismatch.
- Preserve meaning, intent, tone, capitalization, punctuation, whitespace, and formatting.
- Preserve technical terms and artifacts exactly: OpenCode, API names, identifiers, code, commands, flags, paths, URLs, versions, error messages, config keys, and placeholder tokens.
- Apply locale guidance from `.opencode/glossary/<locale>.md` when available. Use `zh-cn.md` for `zh` and `zh-tw.md` for `zht`.
- Use only read, glob, grep, and edit tools. Do not run commands or delegate work.
- Finish only when every requested key is synchronized and no other file has changed.

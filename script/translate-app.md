Translate the product app locale `$1` from the English source dictionaries. English is the source of truth.

The translation request below contains the locale glossary, exact source and target files, plus missing, extra, and placeholder-mismatched keys.

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
- Apply the locale glossary included in the request.
- Use only read, glob, grep, and edit tools. Do not run commands or delegate work.
- Finish only when every requested key is synchronized and no other file has changed.

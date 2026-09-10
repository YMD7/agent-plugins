---
name: symbol-scout
description: Locate symbols, definitions, or project-local references with bounded local LSP output before reading large TypeScript, Rust, or Swift files. Use when `.agents/symbol-scout/config.json` exists and whole-file reads or broad text searches would add avoidable context. Do not use for small files, prose, generated files, or when raw source is itself the object of investigation.
---

# Symbol Scout

Use the project-pinned CLI to narrow source reads:

```bash
node .agents/symbol-scout/cli/symbol-scout.mjs outline <file> [parent]
node .agents/symbol-scout/cli/symbol-scout.mjs locate <file> <exact-symbol>
node .agents/symbol-scout/cli/symbol-scout.mjs definition <file> <line> <column>
node .agents/symbol-scout/cli/symbol-scout.mjs references <file> <line> <column>
```

Run from the Git worktree that owns the source. The config must be committed and unchanged from
`HEAD`. Treat line and column arguments as one-based.

- Start with `locate` when the symbol name and file are known.
- Use `outline` to discover names. Supply `parent` for members of a class, struct, or module.
- Read only the returned range after locating a symbol.
- Use `definition` or `references` from a known source position for semantic navigation.
- Treat truncated results, omitted external locations, and zero references as incomplete evidence.
  Confirm security-sensitive or exhaustive claims with `rg` and focused source reads.
- Fall back to `rg` and range reads when the server is unavailable, the file is small, or the LSP
  result conflicts with source evidence.

Do not add server arguments at invocation time or use Symbol Scout in an untrusted repository.
Changing server commands or limits is a normal reviewed project configuration change.

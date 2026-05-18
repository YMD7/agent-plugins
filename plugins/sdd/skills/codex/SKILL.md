---
name: codex
description: Run Codex CLI from Claude Code for read-only analysis, review, or investigation. Use when an SDD workflow needs an independent Codex reviewer from a Claude Code session.
---

# Codex CLI Helper

Use Codex CLI in non-interactive mode for analysis and review from Claude Code.

## Base Command

```bash
codex --ask-for-approval never exec --sandbox read-only "<prompt>"
```

## Guidance

- Prefer `--sandbox read-only` for review and investigation.
- Use `--sandbox workspace-write` only when the user explicitly asks Codex CLI to make changes.
- Omit `-m` by default and let `~/.codex/config.toml` choose the model.
- For Markdown prompts with headings, write the prompt to `.tmp/codex-prompt.md` and pass it through stdin:

```bash
codex --ask-for-approval never exec --sandbox read-only -o .tmp/codex-output.md - < .tmp/codex-prompt.md
```

- Do not print secret values, tokens, credentials, personal data, or raw dashboard screenshots.

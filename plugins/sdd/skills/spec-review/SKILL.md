---
name: spec-review
description: Codex wrapper for the SDD spec-review workflow. Use when the user asks to run spec-review, /sdd:spec-review, or review SDD Blueprint/requirements/design/tasks documents with the plugin review gate.
---

# spec-review

Codex wrapper for the Claude Code command body.

## Workflow

1. Read `../../commands/spec-review.md`.
2. Follow the same context chain, review taxonomy, triage, artifact, and workflow-state rules.
3. Use Codex-native sub-agent review as the standard independent reviewer path.
4. Do not nest external `codex exec` from a Codex parent session.
5. If sub-agents are unavailable, stop and ask the user before using parent-agent emergency fallback.

## Reviewer Marker

Write the active marker inside the relevant latest `artifacts/REVIEW-{TARGET}.md` review block:

- `<!-- Reviewed by: Codex sub-agents -->`
- `<!-- Reviewed by: Parent agent emergency fallback; user-approved -->`

When running from Claude Code, the command may use external Codex CLI and record:

- `<!-- Reviewed by: Codex CLI -->`

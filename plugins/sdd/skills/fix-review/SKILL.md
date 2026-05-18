---
name: fix-review
description: Codex wrapper for the SDD review-fix workflow. Use when review findings from artifacts/REVIEW-*.md need triage-driven fixes.
---

# fix-review

Codex wrapper for `../../commands/fix-review.md`.

## Workflow

1. Read `../../commands/fix-review.md`.
2. Follow the review artifact, triage, plan, fix, re-review, and workflow-state rules.
3. Preserve the SDD planning approval gate before editing requirements, design, or tasks documents. In Codex, translate Claude `EnterPlanMode` instructions into a normal plan response and wait for explicit user approval before editing.
4. Keep fixes scoped to accepted findings and avoid unrelated spec rewrites.

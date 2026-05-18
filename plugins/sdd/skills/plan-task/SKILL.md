---
name: plan-task
description: Codex wrapper for the SDD plan-task workflow. Use when turning an approved tasks.md item or phase into an implementation plan.
---

# plan-task

Codex wrapper for `../../commands/plan-task.md`.

## Workflow

1. Read `../../commands/plan-task.md`.
2. Follow the task selection, pre-plan investigation, risk review, and implementation-plan output rules.
3. Preserve dependency checks against requirements, design, and tasks.
4. Separate repository implementation from user manual setup or live verification work.
5. In Codex, translate Claude `EnterPlanMode` instructions into a normal plan response and wait for explicit user approval before editing.

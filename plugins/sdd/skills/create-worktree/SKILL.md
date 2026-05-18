---
name: create-worktree
description: Codex wrapper for the SDD create-worktree workflow. Use when the user asks to create an SDD, issue, spec task, or generic git worktree using the plugin workflow.
---

# create-worktree

Codex wrapper for `../../commands/create-worktree.md`.

## Workflow

1. Read `../../commands/create-worktree.md`.
2. Ignore Claude-only frontmatter fields and execute the command body with Codex tools.
3. Preserve argument validation, worktree naming, branch naming, dirty-tree warnings, and secret-file symlink handling.
4. Use project-root-relative paths and avoid `cd`-dependent assumptions.
5. Ask before destructive or workspace-external operations.

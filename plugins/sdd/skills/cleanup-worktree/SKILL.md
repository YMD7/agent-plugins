---
name: cleanup-worktree
description: Codex wrapper for safely cleaning up SDD worktrees and branches with the plugin cleanup workflow.
---

# cleanup-worktree

Codex wrapper for `../../commands/cleanup-worktree.md`.

## Workflow

1. Read `../../commands/cleanup-worktree.md`.
2. Use `../../scripts/cleanup-worktree.sh` as the cleanup implementation when available.
3. Run dry-run first when the target or branch mapping is ambiguous.
4. Preserve secret-file recovery, submodule handling, branch protection, and summary reporting rules.
5. Ask before destructive cleanup if policy or target ambiguity requires approval.

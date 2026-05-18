---
name: cleanup-worktree
description: Codex wrapper for safely cleaning up SDD worktrees and branches with the plugin cleanup workflow.
---

# cleanup-worktree

Codex wrapper for `../../commands/cleanup-worktree.md`.

## Workflow

1. Read `../../commands/cleanup-worktree.md`.
2. Resolve the plugin root first, then run the cleanup script by absolute path. Do not execute literal `../../scripts/cleanup-worktree.sh` from the target repository cwd.
   - If the skill file path is available, plugin root is two directories above this `SKILL.md`.
   - If installed under Claude Code, `${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh` may be available.
   - If installed as a local Codex plugin checkout, locate the directory containing `.codex-plugin/plugin.json`, then use `<plugin-root>/scripts/cleanup-worktree.sh`.
3. Run dry-run first when the target or branch mapping is ambiguous.
4. Preserve secret-file recovery, submodule handling, branch protection, and summary reporting rules.
5. Ask before destructive cleanup if policy or target ambiguity requires approval.

---
name: create-worktree
description: Codex wrapper for the deterministic SDD create-worktree executor. Use when the user asks to create an SDD, issue, spec task, or generic git worktree using the plugin workflow.
---

# create-worktree

Codex wrapper for `../../commands/create-worktree.md`。

## Workflow

1. `../../commands/create-worktree.md`を完全に読む。
2. このSKILLの配置先からplugin rootを絶対パスで解決する。
3. `../../scripts/create-worktree.sh preflight`を実行する。
4. 終了コードと`key=value`出力に従い、必要な場合だけ確認する。
5. 同じ引数で`../../scripts/create-worktree.sh apply`を実行する。
6. executorの出力を報告し、モデル側でGit処理を再実装しない。

Claude専用frontmatterは無視する。ただし引数検証、安全確認、project
context、secret、初期化、workflow-stateの契約は維持する。

`git worktree add`を直接実行してはならない。executorが利用できない場合は
中断し、plugin installationを修復する。

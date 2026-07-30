---
name: core
description: Validate, resolve, materialize, inspect, or update a Workflow Graph Phase 1 Core run state with the bundled deterministic script.
---

# Workflow Graph Core

Workflow Graphは、GoalをNode、Artifact Contract、データ依存EdgeからなるGraphとして
表現し、会話履歴ではなく構造化状態から再開するためのモデルである。

## 正本へのrouting

- 概念、用語、Core lifecycle:
  `../../docs/architecture.md`
- Project Rule、Skill、Script、Adapterの境界:
  `../../docs/extension-model.md`
- Phase 1 schema、操作、入出力:
  `../../docs/core-runtime.md`

質問や作業に必要な正本を最初から最後まで読む。SKILL内の要約で正本を
置き換えない。

## 実行手順

1. このSKILLの配置先からplugin rootを絶対パスで解決する。
2. `../../docs/core-runtime.md`で対象操作の必須入力を確認する。
3. 必須入力が不足している場合は推測せず、欠けている入力を報告して停止する。
4. `../../scripts/workflow_graph.py`の対応subcommandを実行する。
5. 終了コードと検証結果をそのまま扱い、モデル側で解決、materialize、
   readiness、状態遷移を再実装しない。

scriptは契約と状態だけを扱う。executor、scheduler、LLM planner、Project Rule、
Adapter、Human Gate、retry、Replan、remediation、policy操作を代行しない。

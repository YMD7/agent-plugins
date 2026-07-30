# agent-plugins

Claude Code / Codex 向けプラグインのモノレポ。

## Plugins

| Plugin | Description |
|--------|-------------|
| [sdd](./plugins/sdd/) | Spec-Driven Development framework for Claude Code / Codex |
| [workflow-graph](./plugins/workflow-graph/) | Deterministic Workflow Graph Core for Claude Code / Codex |

`workflow-graph` 0.3.0はPhase 1 Coreに加え、Project Initializationの
最小Project Profile契約を検証する。executor、scheduler、
Project Rule／Adapter実装は含まない。

## Usage

### Codexで使う（ローカルマーケットプレイス）

Codex向けmanifestは各pluginの`.codex-plugin/plugin.json`、ローカル
マーケットプレイスは`.agents/plugins/marketplace.json`に配置している。

```bash
codex plugin marketplace add "$PROJECT_ROOT/.agents/plugins"
codex plugin install sdd@agent-plugins
codex plugin install workflow-graph@agent-plugins
```

SDDでは`spec` / `init` / `spec-review` / `create-worktree` /
`cleanup-worktree` / `fix-review` / `plan-task` skillを使う。
Workflow Graphでは`core` skillを使う。

### Claude Codeで一時的に使う（セッション単位）

```bash
claude --plugin-dir ./plugins/sdd
claude --plugin-dir ./plugins/workflow-graph
```

### Claude Codeプロジェクトに導入する（永続）

1. 導入先プロジェクトの `.claude/plugins/` にプラグインを配置する（コピーまたはシンボリックリンク）

2. `.claude/plugins/.claude-plugin/marketplace.json` を作成する

```json
{
  "name": "<marketplace-name>",
  "description": "Project-local plugins",
  "owner": { "name": "<owner>" },
  "plugins": [
    {
      "name": "sdd",
      "description": "Spec-Driven Development framework for Claude Code",
      "source": "./sdd",
      "category": "development"
    },
    {
      "name": "workflow-graph",
      "description": "Execution-graph architecture for agent workflows",
      "source": "./workflow-graph",
      "category": "development"
    }
  ]
}
```

3. ローカルマーケットプレイスを登録し、プラグインをインストールする

```bash
claude plugin marketplace add "$PROJECT_ROOT/.claude/plugins" --scope project
claude plugin install sdd@<marketplace-name> --scope project
claude plugin install workflow-graph@<marketplace-name> --scope project
```

インストール後はセッションを跨いでも自動的に読み込まれる。

## Development

SDD create-worktree executorのテスト:

```bash
bash plugins/sdd/tests/test-create-worktree.sh
```

Workflow Graph Phase 1 Coreのテスト:

```bash
python3 -m unittest discover \
  -s plugins/workflow-graph/tests \
  -p 'test_*.py'
```

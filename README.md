# agent-plugins

Claude Code / Codex 向けプラグインのモノレポ。

## Plugins

| Plugin | Description |
|--------|-------------|
| [sdd](./plugins/sdd/) | Spec-Driven Development framework for Claude Code / Codex |
| [workflow-graph](./plugins/workflow-graph/) | Deterministic Workflow Graph Core for Claude Code / Codex |
| [context-shunt](./plugins/context-shunt/) | Project-local large-source summary PoC for Claude Code / Codex |
| [output-sieve](./plugins/output-sieve/) | Bounded output for approved project checks |
| [symbol-scout](./plugins/symbol-scout/) | Bounded local LSP symbol navigation |

`workflow-graph` 0.4.0は、Project Profile契約に加えて、blocked Nodeの
明示的な解決・再開履歴と、関連Runの最小metadataを検証する。executor、
scheduler、Block Handler、Project Rule／Adapter実装は含まない。

## Usage

### Codexで使う（ローカルマーケットプレイス）

Codex向けmanifestは各pluginの`.codex-plugin/plugin.json`、ローカル
マーケットプレイスは`.agents/plugins/marketplace.json`に配置している。

```bash
codex plugin marketplace add "$PROJECT_ROOT/.agents/plugins"
codex plugin install sdd@agent-plugins
codex plugin install workflow-graph@agent-plugins
codex plugin install output-sieve@agent-plugins
codex plugin install symbol-scout@agent-plugins
```

SDDでは`spec` / `init` / `spec-review` / `create-worktree` /
`cleanup-worktree` / `fix-review` / `plan-task` skillを使う。
Workflow Graphでは`core` skillを使う。
Output Sieveでは`output-sieve` skillを使う。
Symbol Scoutでは`symbol-scout` skillを使う。

`context-shunt` は検証中の project-local PoC であり、Marketplace には登録しない。
導入手順は [plugin README](./plugins/context-shunt/README.md) を参照する。

### Claude Codeで一時的に使う（セッション単位）

```bash
claude --plugin-dir ./plugins/sdd
claude --plugin-dir ./plugins/workflow-graph
claude --plugin-dir ./plugins/output-sieve
claude --plugin-dir ./plugins/symbol-scout
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

Workflow Graph Coreのテスト:

```bash
python3 -m unittest discover \
  -s plugins/workflow-graph/tests \
  -p 'test_*.py'
```

Output SieveとSymbol Scoutのテスト:

```bash
npm --prefix plugins/output-sieve test
npm --prefix plugins/symbol-scout test
```

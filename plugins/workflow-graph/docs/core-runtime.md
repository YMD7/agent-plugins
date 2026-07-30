# Workflow Graph Core Runtime

## 1. 目的

本書は、Workflow Graph Phase 1 Coreの具体的なJSON契約と操作の正本である。

概念、用語、lifecycleは
[Architecture](./architecture.md)、Project Rule、Skill、Script、Adapterの境界は
[Extension Model](./extension-model.md)を正本とする。

Phase 1 Coreは、契約と状態の検証、exact version解決、materialize、
readiness計算、最小限の状態遷移、単一JSON fileへの保存・読込だけを行う。
Nodeを実行しない。

## 2. 共通規則

### 2.1 JSON

- UTF-8のJSON objectを使用する。
- documentは`schema_version: "workflow-graph/v1"`と`kind`を持つ。
- 未知fieldを拒否する。
- 保存時はobject keyを昇順にし、2 space indent、末尾改行を付ける。
- digest計算時はobject keyを昇順にし、空白を除いたUTF-8 JSONを使用する。
- JSON以外の値と非有限numberを拒否する。

このcanonical形式はPhase 1固有であり、外部のcanonical JSON規格を宣言しない。

### 2.2 ID、version、時刻

- IDは64文字以下のlower-kebab形式とする。
- versionは完全なSemVerとする。
- ResolverはIDとversionの完全一致だけを扱う。
- version range、`latest`、semver solverは扱わない。
- 時刻はUTCの`YYYY-MM-DDTHH:MM:SSZ`形式とする。
- Run IDと時刻は入力として受け取り、Core内で生成しない。

version参照は次の形とする。

```json
{
  "id": "analysis-fragment",
  "version": "1.0.0"
}
```

### 2.3 証拠と機密情報

- evidenceには安定した参照またはredact済みの短い要約だけを入れる。
- secret、token、credential、環境値、raw log、会話履歴を保存しない。
- inline payloadはArtifact Contractに宣言したfieldだけを許可する。
- Coreは文字列の意味からsecretを検出しない。入力作成側が機密情報を除外する。
- 外部Artifactはrepository-relative path、SHA-256、要約だけを保存する。

## 3. Goal Contract

`kind`は`goal-contract`とする。

| field | 内容 |
| --- | --- |
| `id` | Goalの安定ID |
| `objective` | 達成目的 |
| `scope` | 対象範囲の文字列array |
| `completion_conditions` | 完了条件 |
| `prohibitions` | 禁止事項の文字列array |
| `human_gate_boundaries` | ユーザー判断境界の記録 |
| `project_rule_refs` | 利用可能なProject Ruleのversion参照 |
| `adapter_refs` | 利用可能なAdapterのversion参照 |

`human_gate_boundaries`、`project_rule_refs`、`adapter_refs`は契約データである。
Phase 1 CoreはHuman Gate、Project Rule、Adapterを実行しない。

conditionは次の形とする。

```json
{
  "id": "verified",
  "description": "検証結果が完了条件を満たす"
}
```

## 4. Catalog、Template、Fragment

`catalog`はTemplateとFragmentの定義を保持する。

```text
catalog
├─ templates[]
└─ fragments[]
```

### 4.1 Template

Templateは次を持つ。

- `id`、`version`
- exact versionの`fragments`
- Graph全体の`artifact_contracts`
- Fragment間を含む追加`edges`
- `completion_conditions`

### 4.2 Fragment

Fragmentは次を持つ。

- `id`、`version`
- `nodes`
- Fragment内の`edges`

Node IDは、1つのMaterialized Run Graph内で一意でなければならない。
Resolverは選択されたFragmentのNodeとEdgeをTemplateへ結合する。

### 4.3 Node

Nodeは次を持つ。

| field | 内容 |
| --- | --- |
| `id` | Graph内で一意なNode ID |
| `responsibility` | 境界づけられた責務 |
| `inputs` | 入力Artifact Contractのversion参照 |
| `outputs` | 出力Artifact Contractのversion参照 |
| `completion_conditions` | Node完了条件 |
| `required_capabilities` | 実行側へ提示するCapability名 |

`required_capabilities`は記録用である。Phase 1 CoreはCapabilityやPolicyを
判定しない。

### 4.4 Edge

Edgeは`producer`、`consumer`、`artifact`を持つ。
`artifact`はArtifact Contractのexact version参照である。

Artifact Contractのproducer、consumer、Nodeのinputs、outputsと一致しないEdgeを
拒否する。Artifactを伴わない順序Edgeは表現できない。

Phase 1はDAGだけを受け入れ、cycleを拒否する。loop、retry、Replanの実行機構は
提供しない。

## 5. Artifact ContractとArtifact

### 5.1 Artifact Contract

Artifact Contractは次を持つ。

| field | 内容 |
| --- | --- |
| `id`、`version` | Artifact種別と契約version |
| `producer` | Node ID。Goal入力は`null` |
| `consumers` | 想定consumerのNode ID array |
| `representation` | `inline`または`reference` |
| `fields` | inline payloadのallowlist |
| `validation_conditions` | Artifact検証条件 |

inline fieldは`name`、`type`、`required`を持つ。`type`は次だけを許可する。

- `string`
- `integer`
- `number`
- `boolean`
- `string-list`

複雑または大きな成果物は`reference`を使う。`reference`契約では`fields`を
空arrayにする。

### 5.2 Artifact

Artifactは次を持つ。

- `id`
- `contract`
- `producer`
- `created_at`
- `provenance`
- `payload`または`external_reference`
- `validation`

`provenance`は`run_id`、入力`artifact_ids`、redact済み`summary`を持つ。
producerを持つ出力Artifactでは、`artifact_ids`が現行Run state内の検証済み
Artifactを参照し、Nodeの各input Contractを1件以上満たすことを要求する。
入力を持たないNodeでは空arrayを許可する。

`external_reference`は次を持つ。

- 正規化済みrepository-relative `path`
- `sha256:<hex>`形式の`digest`
- redact済み`summary`

`validation`は集約`passed`と、全検証条件に対応する
`condition_results`を持つ。各resultは`condition_id`、`passed`、`evidence`を
持つ。

Nodeのreadinessを満たすのは、参照versionが一致し、
`validation.passed=true`のArtifactだけである。

## 6. ResolverとMaterialized Run Graph

Resolverの入力はcatalogとTemplateのID、versionである。

Resolverは次だけを行う。

1. Templateをexact versionで1件に解決する。
2. Templateが参照するFragmentをexact versionで解決する。
3. Node、Edge、Artifact Contractを結合する。
4. 重複、参照切れ、契約不一致、cycleを拒否する。
5. 安定順序へ正規化し、`resolved-graph`を生成する。

自動選択、version推論、動的plugin探索、Project Rule評価は行わない。

`resolved-graph`は次を保持する。

- TemplateとFragmentの固定version参照
- materialize済みNode、Edge、Artifact Contract
- Graph完了条件
- canonical内容の`definition_digest`

Run stateは`resolved-graph`全体を埋め込む。元のcatalogが更新されてもactive Runへ
暗黙に反映しない。

## 7. Run state

`kind`は`run-state`とする。Run stateは単一JSON fileへ保存する。

| field | 内容 |
| --- | --- |
| `run_id` | 永続Run ID |
| `created_at`、`updated_at` | 入力されたUTC時刻 |
| `goal_contract` | 固定したGoal Contract |
| `graph` | 固定した`resolved-graph` |
| `run` | Run status、detail、完了検証結果 |
| `nodes` | Nodeごとのstatus、attempt、detail、完了検証結果 |
| `artifacts` | 検証結果を含むArtifact |

保存先は呼び出し側が明示する。Coreは既定directory、DB、migration、
store abstraction、file lockを提供しない。保存は同じdirectory内の一時fileから
atomic replaceする。

Phase 1 Coreは単一writerを前提とする。atomic replaceは書込中のファイル破損を
防ぐためのものであり、複数transitionの競合制御は提供しない。呼び出し側が
state更新を直列化する。file lock、revision field、optimistic concurrencyは
実装しない。

## 8. Readinessとlifecycle

初期Nodeは次の規則で決める。

- 入力がない、または全入力に検証済みArtifactがある: `ready`
- それ以外: `pending`

Artifact追加後、`pending`と`ready`だけを再計算する。Capability、Policy、
承認結果はreadinessへ含めない。

Phase 1が検証するNode eventは次のとおり。

| event | 許可する遷移 | 必須データ |
| --- | --- | --- |
| `start-node` | `ready` → `running` | Node ID |
| `succeed-node` | `running` → `succeeded` | 全出力Artifact、完了検証結果 |
| `fail-node` | `running` → `failed` | failure |
| `block-node` | `ready`／`running` → `blocked` | Block Report |
Phase 1が検証するRun eventは次のとおり。

- `succeed-run`
- `fail-run`
- `block-run`

Node statusからRun全体の`blocked`や`failed`を暗黙に集約しない。
Run eventを明示する。`succeed-run`だけは全Nodeが`succeeded`で、
GoalとGraphの全完了条件がpassedであることを要求する。

`attempt`はPhase 1では0または1だけを許可する。retry、resume、loop、
Replanに加え、`waiting`、`cancelled`、`skipped`の具体遷移は実装しない。
これらの概念上の意味はArchitectureに残し、必要性が明らかになった段階で
独立して追加する。

## 9. Blockとfailure

Block Reportは状態交換用のデータであり、Block Handlerではない。
次を保持する。

- `id`、`fingerprint`
- 共通`category`
- `attempted_operation`
- `evidence`
- `goal_impact`
- `safe_workaround`
- `permanent_option`
- `unblock_condition`

Coreは分類や対応を選ばず、remediationを起動しない。

failureは`code`、`summary`、`evidence`を持つ。Block Reportと別のfieldへ保存し、
`blocked`と`failed`を混同しない。

## 10. Script

決定論的Coreは`../scripts/workflow_graph.py`にある。

```text
workflow_graph.py validate <document>
workflow_graph.py resolve --catalog <file> --template-id <id>
                          --template-version <version> [--output <file>]
workflow_graph.py materialize --goal <file> --resolved <file>
                              --run-id <id> --created-at <UTC>
                              [--artifacts <file>] --state <file>
workflow_graph.py transition --state <file> --event <file>
workflow_graph.py show --state <file>
```

- `resolve`はcanonical JSONを標準出力または指定fileへ出力する。
- `materialize`は新しいRun state fileを保存し、既存fileへの上書きを拒否する。
- `transition`は検証後に同じRun state fileをatomic replaceする。
- `show`は保存済みstateを検証し、canonical JSONを標準出力する。
- validation errorは終了コード3、I/O errorは終了コード4とする。

scriptはexecutor、scheduler、LLM planner、Human Gate、Project Rule、
Adapter、policy、remediationを実装しない。

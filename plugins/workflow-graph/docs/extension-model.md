# Workflow Graph Extension Model

## 1. 目的

本書は、Workflow Graph Coreへプロジェクト固有動作と外部実行基盤を
接続する方法を定義する。

Core概念、Run lifecycle、状態、Artifact Contractの正本は
[Workflow Graph Architecture](./architecture.md)である。本書では定義を
複製せず、拡張側の責務とbindingだけを扱う。

## 2. 3層モデル

```text
Workflow Graph Core
    └─ 状態、契約、lifecycle、extension point
             │
Project Rule
    └─ プロジェクト固有の選択、制約、完了作法
             │
Adapter
    └─ harness、executor、外部サービスとの接続
```

判断基準は次のとおり。

- Core: 何が起きたか
- Project Rule: 何をするか
- Adapter: どう実行するか

| 関心事 | Core | Project Rule | Adapter |
| --- | --- | --- | --- |
| RunとNodeの状態 | 所有 | 参照 | 反映 |
| Artifact Contract | 所有 | 具体化 | 入出力へ変換 |
| Fragment選択 | 解決点を提供 | 選択条件を定義 | 関与しない |
| 完了作法 | 完了条件を表現 | 手順と制約を定義 | 操作を実行 |
| Block | 状態とReport | 分類と対応方針 | 外部操作 |
| 承認 | 境界を表現 | 必要条件を定義 | harnessへ接続 |
| Remediation | 関連Runを表現 | 起動方針を定義 | 実行する |

## 3. Project Profile

Project Profileは、Project Initializationで生成される機械可読snapshotである。
LLMがGoalごとにプロジェクト資料を再監査する代わりに、Resolverが参照する。

Project Profileは概念上、次を記録できる必要がある。

- Profile IDとversion
- 適用対象と生成時刻
- 利用可能なProject Rule
- Skill、Script、Template、Fragment
- AdapterとCapability
- harness、実行モード、Policyの正規化結果
- 完了作法と検証手段
- 永続状態と揮発状態の区別
- 情報の出典と有効性

Profileはcredentialやraw logを含めない。変化し得る外部状態は、snapshotの
取得時刻と再検証条件を持つ。

具体的な保存schemaは未決である。

## 4. Project Rule

Project Ruleは、Core契約の範囲内でプロジェクト固有の選択と制約を定義する。

代表的な責務:

- Goalを対象範囲とWork Itemへ対応付ける
- 利用可能なTemplateとFragmentを絞り込む
- 計画承認やHuman Gateの要否を決める
- write set、並列実行、隔離方法の制約を定める
- 検証、review、merge、cleanupなどの完了作法を定める
- Blockを分類し、即時対応と恒久対応を決める
- Remediation Runの適格性と深さ上限を定める
- 利用可能なAdapterとCapabilityを制限する

Project Ruleは次を行わない。

- Coreの状態遷移を別の意味で再定義する
- harnessのPolicyや承認結果を上書きする
- credentialを埋め込む
- Adapterの具体的な接続処理を実装する

Ruleには安定したIDとversionを付け、Materialized Run Graphから参照可能にする。

## 5. TemplateとFragmentの提供

TemplateとFragmentは、Coreが解決できる拡張packageとして提供する。

各定義には次のmetadataが必要となる。

- 安定した名前とversion
- 適用条件
- 必要な入力Artifact Contract
- 生成する出力Artifact Contract
- 必要なSkill、Script、Adapter
- 互換性条件
- 完了条件

Templateは複数のFragmentを合成できる。Project RuleもFragmentを参照できるが、
Fragment内部へプロジェクト固有の暗黙条件を埋め込まない。

ResolverはGoal、Project Profile、Project Ruleから候補を絞り、
Materializerへ確定した参照を渡す。具体的なschemaやDSLは本書では定めない。

## 6. SkillとScript

SkillとScriptは異なる責務を持つ。

| 種別 | 適する処理 |
| --- | --- |
| Skill | ドメイン概念、判断基準、調査方法、設計ガイド |
| Script | schema検証、変換、依存解決、dedupe、状態更新 |

同じ入力から同じ出力を期待できる処理はScriptを優先する。解釈、設計、
証拠評価など、文脈に応じた判断が必要な処理はSkillとLLM Plannerを使う。

Scriptは次を宣言する。

- 入出力Artifact Contract
- 必要なCapability
- 副作用
- 失敗時の結果
- 冪等性または再実行条件

SkillはRun lifecycleを所有しない。Skillの結果はArtifactとしてCoreへ戻す。

## 7. 独立Skillとの合成

仕様駆動開発などの独立Skillは、Workflow Graphの必須依存にしない。

- 独立SkillはWorkflow Graphなしで利用できる
- Workflow Graphは独立Skillなしで利用できる
- 両方が利用可能な場合、Project Ruleが必要なNodeへSkillをbindingする
- Skill固有の成果物はArtifact Contractを介して受け渡す
- Skill固有のファイル更新や完了作法はProject Ruleが決める

SDDはこの合成モデルに従う独立pluginである。spec、requirements、design、
tasksなどのドメイン知識を提供できるが、Goal RunやRun lifecycleは所有しない。

## 8. Adapter

AdapterはCoreの抽象契約を具体的な実行基盤へ接続する。Adapterの失敗や
CapabilityをCoreへ暗黙に伝播させず、正規化されたArtifactまたはReportを返す。

### 8.1 Harness Adapter

Harness Adapterは次を正規化する。

- 利用可能なCapability
- sandboxとPolicy
- 実行モード
- 承認機構の有無
- tool実行結果
- 一時的なruntime binding

Harness Adapterは承認を代行せず、harnessの判断をCoreが扱える形へ変換する。

### 8.2 Approval Adapter

Approval Adapterは、承認機構を持たないharnessへ任意の承認境界を追加する。

利用する場合も、Human Gateと操作許可を区別する。

- Human Gate: 非等価な意味判断
- Approval Adapter: 操作の実行許可

既存の承認機構がある場合は二重化しない。

### 8.3 Executor Adapter

Executor AdapterはNodeが要求する操作を外部実行基盤へ渡す。

最低限、次を扱う。

- 入力Artifactの変換
- Capabilityの事前確認
- 実行開始と結果取得
- timeout、cancel、再接続
- 出力ArtifactまたはBlock Reportへの正規化
- runtime IDと永続IDの分離

Adapter APIの具体的signatureは未決である。

## 9. Block Handler

Block Handlerは`on_block`イベントを受け取り、Project Ruleに従って対応を選ぶ
拡張である。

代表的な処理:

- Block Reportの証拠を検証する
- Block種別を分類する
- Goalを継続する安全な回避策を選ぶ
- 恒久対応案を記録する
- retry、waiting、Replan、cancelのいずれかへrouteする
- Remediation Runの適格性を判定する

Block HandlerはPolicy拒否を自動的に緩和せず、Replanを権限拡張として
利用しない。

## 10. Optional Remediation Run

Remediation Runは任意の拡張であり、Main Goal Runと関連付けられた独立Runとして
起動する。

Project Ruleは次を定義する。

- 起動対象となるBlock分類
- 自動起動またはHuman Gateの条件
- dedupeに使うfingerprint
- 実行可能なCapability
- Main Goal Runが待機するか継続するか
- remediation depthの上限

Adapterは、隔離された実行環境の準備、外部作業の開始、状態取得、
終了処理を担当する。

Coreはparent、related Run、depth、Resolution Reportだけを保持し、
具体的な起動方法を規定しない。

## 11. Project Initialization

Project Initializationは次の順で拡張を構築する。

1. プロジェクトのルール、workflow、完了作法を監査する
2. Skill、Script、runner、外部サービスを列挙する
3. harnessのCapability、Policy、承認を検出する
4. 永続状態と揮発状態を分離する
5. Project Profileを生成する
6. Project RuleとAdapter bindingを検証する

初期化結果には出典とversionを持たせる。変更検出時は影響するProfile項目、
Rule、bindingだけを増分更新する。

## 12. Bootstrap時のbinding

BootstrapはMaterialized Run Graphを作る前に次をbindingする。

- Goal Contractに適用可能なProject Rule
- 解決されたTemplateとFragment
- Nodeが利用するSkillとScript
- 必要なHarness、Approval、Executor Adapter
- Block Handler
- Artifactの保存先参照

bindingは名前だけでなく、version、互換性、Capability、設定の出典を記録する。
materialize後のRunはその参照を固定する。

必要な拡張が存在しない場合、Resolverは暗黙の代替を作らず、不足を
Block候補として報告する。

## 13. version更新とactive Run

新しいGoalは最新の互換定義からmaterializeする。active Runは
materialize時のTemplate、Fragment、Project Rule、Adapter参照を維持する。

定義更新をactive Runへ反映する場合は、明示的な再materializeを要求する。
再materializeでは次を検証する。

- Goal Contractが変わっていないこと
- 成功済みArtifactの契約互換性
- Node IDと状態の対応
- 新旧Project Ruleの差分
- 必要Capabilityの変化
- 再承認が必要な外部作用

具体的な移行手順と互換性schemaは未決である。

## 14. plugin構成と配布

Workflow Graphは独立したpluginとして配布する。SDDを含む他pluginとは
別のversionとインストール単位を持つ。

現在の最小構成:

```text
workflow-graph/
├─ .codex-plugin/plugin.json
├─ .claude-plugin/plugin.json
├─ docs/
│  ├─ architecture.md
│  ├─ extension-model.md
│  └─ core-runtime.md
├─ skills/core/SKILL.md
├─ scripts/workflow_graph.py
└─ tests/test_workflow_graph.py
```

Phase 1では、Core契約の検証、exact version解決、materialize、状態遷移検証、
単一JSON fileの保存・読込だけを配布する。Skillは正本へのroutingとscriptの
薄い実行手順だけを提供する。

executor、scheduler、LLM planner、Project Rule／Adapterの完全なinterface、
Block Handler、remediation、policy操作は実装済みとして宣言しない。
将来componentを追加する場合も、実在するものだけをmanifestへ登録し、
Coreと拡張のversion互換性を明示する。

Coreを専用repositoryへ分離する判断は、独立CLIやSDK、独立package、
異なるrelease cycle、別のcontributorまたはsecurity boundaryが必要になった
時点で行う。

## 15. 拡張の適合条件

拡張は次を満たす必要がある。

- Coreの状態とArtifact Contractを別の意味で再定義しない
- プロジェクト固有判断をCoreへ要求しない
- harnessのsandbox、Policy、承認を迂回しない
- 入出力、Capability、副作用、versionを宣言する
- secret、token、raw logを永続Artifactへ保存しない
- 一時的なruntime IDを永続identityとして扱わない
- BlockとReplanを混同しない
- active Runの固定契約を暗黙に更新しない
- 拡張がなくてもCoreの概念モデルが成立する

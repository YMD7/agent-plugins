# Workflow Graph Architecture

## 1. 目的

Workflow Graphは、エージェントの作業をGoal、Node、Artifact、
データ依存Edgeからなる実行グラフとして表現するためのアーキテクチャである。

主な目的は次のとおり。

- 実行順序ではなく、実際のデータ依存を明示する
- Node間を検証可能なArtifact Contractで接続する
- 独立した仕事を並列化し、障害を局所化する
- 会話履歴ではなく、構造化状態とArtifactからRunを再開する
- 決定論的処理とLLMによる判断を分離する
- 実行環境やプロジェクトに依存しないCore契約を提供する

本書はWorkflow Graph Coreの概念上の正本である。プロジェクト固有の選択や
外部実行基盤との接続は
[Extension Model](./extension-model.md)で定義する。
同梱するPhase 1 Coreの具体的なschemaと操作は
[Core Runtime](./core-runtime.md)で定義する。

## 2. 非目的

Workflow Graphは次を目的としない。

- 知識グラフ、commit DAG、共有記憶の汎用モデル
- 特定プロジェクトの既存手順を別形式へ転記すること
- 特定の仕様駆動開発手法を必須にすること
- 特定harness、runner、CI、外部サービスへの依存
- harnessが持つsandbox、承認、Policyの再実装
- runtime、CLI、永続ストア、分散executorの具体実装
- すべてのGoalを事前定義された巨大グラフへ固定すること

## 3. 設計原則

1. Edgeは実行順序ではなくデータ依存を表す。
2. Nodeは1つの境界づけられた仕事を所有する。
3. Node間の受け渡しは構造化されたArtifact Contractを使う。
4. 変換、検証、依存解決、状態更新などの決定論的処理はScriptへ置く。
5. LLMは分解、設計、分類、証拠評価などの非決定的な判断へ限定する。
6. 独立Nodeは並列化し、失敗の影響を局所化する。
7. Runは会話コンテキストではなく永続状態とArtifactから再開する。
8. 実行可否はharnessのCapability、Policy、承認へ委ねる。
9. プロジェクト固有動作はCoreへ含めない。
10. 未実装のschema、API、挙動を確定済みとして扱わない。

## 4. 用語

| 用語 | 定義 |
| --- | --- |
| Workflow Graph | 作業をNodeとデータ依存Edgeで表す実行モデル |
| Goal | ユーザーが達成したい目的 |
| Goal Contract | 目的、範囲、完了条件、禁止事項を固定した契約 |
| Graph Template | 再利用可能な既知のグラフ形状 |
| Fragment | 組み合わせ可能な部分グラフ |
| Materialized Run Graph | 特定Goal用に具体化された実行グラフ |
| Goal Run | Goal全体を管理するRun |
| Work Item Run | Goal内の実装・調査単位 |
| Node | 1つの境界づけられた仕事 |
| Edge | Node間のデータ依存とArtifact Contract |
| Artifact | Nodeが生成・消費する構造化成果物 |
| Project Initialization | 導入時の監査とProject Profile構築 |
| Bootstrap | Goalごとの解決、materialize、実行準備 |
| Project Profile | プロジェクト情報の機械可読snapshot |
| Project Rule | プロジェクト固有の選択、制約、完了作法 |
| Resolver | 利用可能なTemplate、Fragment、拡張を解決する責務 |
| Materializer | 解決結果からRun Graphを生成する責務 |
| LLM Planner | 非決定的な分解、設計、route判断を行う責務 |
| Skill | 特定ドメインの概念、知識、判断ガイド |
| Script | 決定論的な処理を実行するコード |
| Adapter | Core契約を外部実行基盤へ接続する拡張 |
| Human Gate | 非等価な意味判断をユーザーへ委ねる境界 |
| Block | 現在の条件ではNodeまたはRunを進められない状態 |
| Replan | Goal Contract内で計画を再構成すること |
| Remediation Run | Blockの恒久対応を別系統で実行する関連Run |

新しい用語は、既存用語では表現できない独立責務がある場合だけ追加する。

## 5. Graphの定義段階

### 5.1 Graph Template

Graph Templateは、頻繁に使う既知のグラフ形状を再利用するための定義である。
Templateの利用は任意であり、未知のGoalを固定形状へ押し込めない。

Templateは、必要なFragment、入力条件、完了条件、利用可能なProject Ruleを
参照できる。具体的なschemaやDSLは本設計では定めない。

### 5.2 Fragment

Fragmentは、調査、計画、実装、検証、review、cleanupなどの
組み合わせ可能な部分グラフである。

Fragmentは次を宣言できる必要がある。

- 必要な入力Artifact
- 生成する出力Artifact
- 内部Nodeとデータ依存
- 適用条件
- 必要なSkill、Script、Adapterの参照
- 完了条件

プロジェクト固有のFragmentも提供できるが、固有の選択や制約を暗黙に
内包せず、Project Ruleから明示的に参照する。

### 5.3 Materialized Run Graph

Materialized Run Graphは、特定Goalに対してResolverとMaterializerが生成した
具体的な実行グラフである。

最低限、次を保持する。

- Goal Contract
- 選択されたTemplateとFragmentの参照
- Node、Edge、Artifact Contract
- Project ProfileとProject Ruleのversion参照
- 利用可能なSkill、Script、Adapterのbinding
- RunとNodeの状態
- 完了条件と検証結果

新しいGoalは最新定義からmaterializeする。実行中Runはmaterialize時の契約を
固定する。定義変更を反映する場合は、明示的な再materializeを要求する。

ここでいうmaterializeは具体化を意味し、通常の意味でのコンパイルを
要求しない。

## 6. Run構造

### 6.1 Goal Contract

Goal ContractはRunの判断境界を固定する。

- 目的
- 対象範囲
- 完了条件
- 禁止事項
- ユーザー判断が必要な境界
- 利用可能なProject RuleとAdapter

Goal Contractを変更する要求はReplanではない。Human Gateで確認するか、
新しいGoalとして扱う。

### 6.2 Goal Run

Goal RunはGoal Contract、Work Item Runの関係、共有Artifact、
Goal全体の完了状態を管理する。

Goal Runは子Runの会話履歴を暗黙の共有状態として扱わない。共有が必要な情報は
Artifactとして公開する。

### 6.3 Work Item Run

Work Item Runは、Goal内の境界づけられた実装・調査単位である。必要に応じて
調査、実装計画、Human Gate、実行、検証、成果物更新を含む。

実装計画はRun Graphそのものではなく、Work Item Runが生成するArtifactである。
計画承認の要否はProject Ruleが決める。

## 7. Node、Edge、Artifact Contract

### 7.1 Node

Nodeは1つの責務を持ち、明示された入力だけを読み、契約に従う出力を生成する。

Nodeの定義には、概念上次が必要となる。

- 安定したNode ID
- 責務
- 入力Artifact Contract
- 出力Artifact Contract
- 完了条件
- 実行に必要なCapability
- 利用するSkill、Script、Adapterの参照
- 失敗、Block、再試行時の遷移規則

### 7.2 Edge

Edgeは、上流Nodeが生成し下流Nodeが消費するデータ依存を表す。
「Aの次にBを実行する」という順序だけではEdgeを作らない。

制御判断が必要な場合は、分類結果やDecision Artifactを明示し、
そのArtifactを消費するrouteとして表現する。

### 7.3 Artifact Contract

Artifact Contractは、Node間で共有する情報の意味と検証境界を定義する。

最低限、次を表現できる必要がある。

- Artifact種別と契約version
- producerと想定consumer
- 必須項目と検証条件
- provenance
- payloadまたは外部参照
- 生成時刻と生成Run
- 検証結果

大きな出力や外部状態は、必要なmetadataと安定した参照だけをArtifactへ保存する。
参照先が変化し得る場合は、再開時に必要な範囲で再検証する。

## 8. Project InitializationとBootstrap

### 8.1 Project Initialization

Project Initializationは、既存プロジェクトへWorkflow Graphを導入する際の
一度限りの監査・初期構築である。

調査対象には次を含む。

- 既存ルールとworkflow
- 完了作法
- Skill、Script、runner
- harnessのCapability、Policy、sandbox、承認
- Git、review、merge、cleanup
- 永続状態と揮発状態

出力は機械可読なProject ProfileとProject Ruleである。Goalごとに全資料を
再監査せず、変更時は影響範囲だけを増分更新する。

### 8.2 Bootstrap

BootstrapはGoalごとに次を行う。

1. Goal Contractを確定する
2. harnessと実行モードを検出する
3. Project Profile、Skill、Script、Adapterを解決する
4. TemplateとFragmentを選択する
5. Materialized Run Graphを生成する
6. 必要なRun Authorizationを取得する
7. 永続Run IDを払い出す

Run Authorizationはharnessの承認を置き換えない。Goal Contract内で予定される
作用と既知リスクを提示するためのRun境界である。

## 9. Resolver、Materializer、LLM Planner

### 9.1 Resolver

ResolverはGoal、Project Profile、Project Rule、利用可能な拡張を入力として、
使用可能なTemplate、Fragment、Skill、Script、Adapterを解決する。

互換性検証、version選択、依存解決、重複排除など、同じ入力から同じ結果を
得られる処理は決定論的に実行する。

### 9.2 Materializer

MaterializerはResolverの結果からMaterialized Run Graphを生成する。
Node ID、Edge、Artifact Contract、binding、初期状態を確定し、
参照した定義versionを記録する。

### 9.3 LLM Planner

LLM Plannerは次のような判断を担当する。

- GoalをWork Itemへ分解する
- 複数の適用可能なFragmentから選択する
- 実装方式を設計する
- 証拠を評価する
- 非自明なrouteやReplanの必要性を判断する

schema検証、状態更新、機械的なroute、dedupeをLLMへ委ねない。

## 10. Lifecycleと状態遷移

RunとNodeは、少なくとも次の論理状態を区別する。

| 状態 | 意味 |
| --- | --- |
| `pending` | 依存または開始条件を待っている |
| `ready` | 必要な入力がそろい実行可能 |
| `running` | 実行中 |
| `waiting` | 解除条件が既知の外部イベントを待っている |
| `blocked` | 現在のCapability、Policy、外部条件では進行不能 |
| `succeeded` | 完了条件と出力契約を満たした |
| `failed` | 1回の実行が失敗し、修正または再試行判断が必要 |
| `cancelled` | 明示的に中止された |
| `skipped` | routeにより実行対象外となった |

具体的な永続schemaは未決とするが、次の不変条件を維持する。

- 入力契約を満たすまでNodeを`ready`にしない
- 出力検証が完了するまで`succeeded`にしない
- `blocked`と`failed`を混同しない
- `waiting`には解除条件を記録する
- 終端状態から暗黙に実行状態へ戻さない
- 再試行はattemptとして履歴を残す

## 11. 並列化、合流、分岐、反復

### 11.1 並列化

互いの出力を必要としないNodeは並列実行できる。並列実行の可否はデータ依存、
write set、利用可能なCapabilityから判断する。

一部Nodeの失敗で成功済みArtifactを破棄しない。書き込みが競合する場合の
隔離方法はProject RuleとAdapterが決める。

### 11.2 合流

全結果を必要とする処理だけをfan-inにする。合流Nodeは、欠落入力を許容するか、
全入力を必須にするかをArtifact Contractで宣言する。

### 11.3 分岐

分類や意味判断は構造化Artifactとして出力し、同じ判断結果から同じrouteを
選択する決定論的処理へ渡す。

非等価な選択やGoal Contract変更が必要な場合はHuman Gateへ遷移する。

### 11.4 反復

反復には停止条件が必要である。停止条件は、最大反復、予算、期限、
検証成功、進捗停止などを組み合わせられる。

具体的な回数や予算値はCoreで固定しない。発見済み・却下済み候補を記録し、
同じ候補の再発見による非収束を防ぐ。

## 12. 永続化と再開

Runは会話履歴ではなく、次の構造化情報から再開する。

- Run ID、parent Run ID、Goal Contract
- materialize時のProject ProfileとProject Rule参照
- Node、Edge、status、attempt
- 入出力Artifact参照
- Block、Resolution、Replan履歴
- 外部作業の安定した参照
- 完了条件の検証結果

再割り当て可能なprocess、pane、sessionなどのruntime IDを永続identityにしない。
再開時は安定したRun IDとArtifactからruntime bindingを再解決する。

## 13. Replan

Replanの条件は次に限定する。

> Goal Contractは変わっていないが、現在の計画では達成できない。

Replan対象:

- 実装方式または技術的前提が成立しない
- Work Item分割や依存順序が誤っている
- API、依存ライブラリ、branchなどの外部状態が変化した
- Resolverが誤ったFragmentまたはProject Ruleを選択した
- 検証により現在の設計では完了条件を満たせない

Replan対象外:

- 単純な実装ミス: 修正または再試行
- 一時障害: bounded retryまたは待機
- Capability不足、Policy拒否: Block
- 要件変更、非等価な選択: Human Gateまたは新Goal
- 外部担当者待ち: 待機

Replanは権限拡張や派生保守タスクを開始しない。成功済みArtifactは契約が
引き続き有効な範囲で保持する。

## 14. Block Contract

CoreはBlockの状態と交換契約を所有し、具体的な対応方針を所有しない。

Coreの責務:

- RunまたはNodeの`blocked`状態
- `on_block`イベント
- Block ReportとResolution Report
- 再試行、再開、待機、Replan、中止への遷移
- parent Run、related Run、remediation depthの記録

Block Reportは最低限、次を表現できる必要がある。

- 安定したBlock IDとfingerprint
- 分類
- 実行しようとした操作
- 拒否または失敗の証拠
- Goalへの影響
- 今回の安全な回避策
- 恒久対応案
- 解除条件

共通分類語彙は次を最低限の基準とする。分類判断と対応はProject Ruleが行う。

- project defect
- harness defect
- capability gap
- valid policy denial
- external dependency
- upstream limitation

Resolution Reportは、採用した対応、残存リスク、再開可能なNode、
再検証結果を記録する。

## 15. Remediation Run

Blockの恒久対応を別Runとして起動する機能は任意拡張である。

```text
Main Goal Run
├─ 安全な回避策でGoalを継続
└─ Optional Remediation Run
```

Remediation RunはMain Goal Runへの割り込みNodeではなく、関連付けられた
独立Runである。Coreは関連Runとdepthを表現するが、起動条件、実行基盤、
ネスト上限を規定しない。

## 16. harness承認との境界

Workflow Graphは「何を、いつ実行するか」を決める。harnessは「その操作を
実行してよいか」を決める。

- sandbox、Capability、Policy、承認判定はharnessが所有する
- Coreは拒否を回避するためにPolicyを変更しない
- 承認済みGoal Contract内で独自の逐次承認を追加しない
- Human Gateは非等価な意味判断に限定する
- 承認機構を持たないharnessには任意のApproval Adapterを利用できる

強い実行モードをCoreが一律禁止または許可しない。既知リスクの提示と
実際の許可判定はProject Rule、Adapter、harnessの責務である。

## 17. セキュリティ不変条件

- secret、token、credentialをRun stateへ保存しない
- raw logや不要な個人情報をArtifactへ保存しない
- Artifactには必要最小限のpayloadとprovenanceだけを保持する
- 外部参照は再開時に必要な範囲で再検証する
- AdapterのCapabilityをCoreのCapabilityとして暗黙に扱わない
- Policy拒否をReplanや自動権限拡張で迂回しない
- 反復、再試行、並列化には明示的な上限を設定可能にする
- 変更可能な定義とactive Runの固定契約を混同しない
- 重要な出力はGoal、producer、入力、検証結果へ追跡可能にする

## 18. 未決事項

次は本概念設計では意図的に未決とする。

- runtime実装言語
- Run stateの具体的な保存形式
- Template、FragmentのschemaまたはDSL
- Adapter APIの具体的signature
- active Runへ定義更新を反映する具体手順
- distributed execution
- retry回数、token budget、時間予算の既定値
- 個別導入先のCapability、Policy
- 外部executorを起動する具体的なScript

これらはruntime実装または導入先の要件が明らかになった時点で、
独立した設計判断として確定する。

同梱するPhase 1 Coreが採用した実装言語、保存形式、Template／Fragment schema、
最小操作は[Core Runtime](./core-runtime.md)を正本とする。これはWorkflow Graphの
全実装へ要求する汎用仕様ではない。

#!/bin/bash

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTOR="$TEST_DIR/../scripts/create-worktree.sh"
TEST_BASH="${TEST_BASH:-bash}"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sdd-create-worktree-test.XXXXXX")"
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  case "$TEMP_ROOT" in
    "${TMPDIR:-/tmp}/sdd-create-worktree-test."*) rm -rf -- "$TEMP_ROOT" ;;
  esac
}
trap cleanup EXIT

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'ok - %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'not ok - %s\n' "$1" >&2
  if [[ -n "${2:-}" ]]; then
    printf '%s\n' "$2" >&2
  fi
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  local output="${4:-}"

  if [[ "$actual" -eq "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected=$expected actual=$actual)" "$output"
  fi
}

assert_contains() {
  local output="$1"
  local expected="$2"
  local label="$3"

  if [[ "$output" == *"$expected"* ]]; then
    pass "$label"
  else
    fail "$label (missing: $expected)" "$output"
  fi
}

create_repo() {
  local name="$1"
  local repo="$TEMP_ROOT/$name"

  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.name "SDD Test"
  git -C "$repo" config user.email "sdd-test@example.invalid"
  printf '# test\n' > "$repo/README.md"
  printf '.worktrees/\n' > "$repo/.gitignore"
  git -C "$repo" add README.md .gitignore
  git -C "$repo" commit -q -m "Initial commit"
  mkdir -p "$repo/.worktrees"
  printf '%s\n' "$repo"
}

run_executor() {
  run_executor_path "$EXECUTOR" "$@"
}

run_executor_path() {
  local executor="$1"
  shift
  set +e
  OUTPUT=$(env -u CLAUDE_PLUGIN_ROOT -u CODEX_PLUGIN_ROOT \
    "$TEST_BASH" "$executor" "$@" 2>&1)
  STATUS=$?
  set -e
}

test_preflight_is_deterministic() {
  local repo
  repo=$(create_repo preflight)
  repo=$(cd "$repo" && pwd -P)

  run_executor preflight fix deterministic-run \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --base-ref HEAD \
    --skip-dependencies \
    --no-retro

  assert_status 0 "$STATUS" "preflightが成功する" "$OUTPUT"
  assert_contains "$OUTPUT" "status=ready" "ready状態を返す"
  assert_contains "$OUTPUT" \
    "branch=fix/deterministic-run" \
    "ブランチ名を決定する"
  assert_contains "$OUTPUT" \
    "worktree_path=$repo/.worktrees/fix-deterministic-run" \
    "絶対パスを決定する"

  if [[ ! -e "$repo/.worktrees/fix-deterministic-run" ]] \
    && ! git -C "$repo" show-ref --verify --quiet \
      refs/heads/fix/deterministic-run; then
    pass "preflightは変更を加えない"
  else
    fail "preflightは変更を加えない"
  fi
}

test_dependency_action_is_explicit() {
  local repo
  repo=$(create_repo dependencies)
  printf '{}\n' > "$repo/package-lock.json"
  git -C "$repo" add package-lock.json
  git -C "$repo" commit -q -m "Add lockfile"

  run_executor preflight fix dependency-mode \
    --project-root "$repo" \
    --worktree-base .worktrees

  assert_status 10 "$STATUS" "依存初期化は明示選択を要求する" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=dependency_action_required" \
    "依存初期化の警告を返す"

  run_executor preflight fix dependency-mode \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 0 "$STATUS" "依存初期化のskipを明示できる" "$OUTPUT"
}

test_spec_and_issue_names() {
  local repo
  repo=$(create_repo naming)
  mkdir -p "$repo/spec/specs/B01-S01-feature-x"
  printf '# tasks\n' > "$repo/spec/specs/B01-S01-feature-x/tasks.md"
  git -C "$repo" add spec/specs/B01-S01-feature-x/tasks.md
  git -C "$repo" commit -q -m "Add spec"

  run_executor preflight B01-S01 1.2 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 0 "$STATUS" "spec taskを解決する" "$OUTPUT"
  assert_contains "$OUTPUT" \
    "branch=spec/B01-S01-feature-x/T1.2" \
    "spec branch名を決定する"

  run_executor preflight issue 42 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --issue-title "Fix login error" \
    --skip-dependencies

  assert_status 0 "$STATUS" "Issue入力を解決する" "$OUTPUT"
  assert_contains "$OUTPUT" "branch=issue/42-fix-login-error" \
    "Issue branch名を決定する"
}

test_missing_spec_preserves_executor_error() {
  local repo
  repo=$(create_repo missing-spec)

  run_executor preflight B99-S99 T1.1 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 3 "$STATUS" "存在しないspecを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=spec_not_found" \
    "subprocessの検証エラーを保持する"
}

test_invalid_task_id_is_rejected() {
  local repo
  repo=$(create_repo invalid-task)
  mkdir -p "$repo/spec/specs/B01-S01-feature-x"
  printf '# tasks\n' > "$repo/spec/specs/B01-S01-feature-x/tasks.md"
  git -C "$repo" add spec/specs/B01-S01-feature-x/tasks.md
  git -C "$repo" commit -q -m "Add spec"

  run_executor preflight B01-S01 T1-invalid \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 3 "$STATUS" "不正なtask IDを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=invalid_task_id" \
    "task IDの安定したエラーを返す"
}

test_secret_link_is_created_without_value_output() {
  local repo
  repo=$(create_repo secrets)
  repo=$(cd "$repo" && pwd -P)
  printf '.env\n' >> "$repo/.gitignore"
  git -C "$repo" add .gitignore
  git -C "$repo" commit -q -m "Ignore env"
  printf 'TEST_TOKEN=dummy\n' > "$repo/.env"

  run_executor apply fix secret-link \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies \
    --no-retro

  assert_status 0 "$STATUS" "secret link付きapplyが成功する" "$OUTPUT"
  assert_contains "$OUTPUT" "secret_links=1" "secret件数だけを返す"
  if [[ -L "$repo/.worktrees/fix-secret-link/.env" ]] \
    && [[ "$(readlink "$repo/.worktrees/fix-secret-link/.env")" == "$repo/.env" ]]; then
    pass "secretをrootへのsymlinkにする"
  else
    fail "secretをrootへのsymlinkにする"
  fi
  if [[ "$OUTPUT" != *"TEST_TOKEN"* ]] && [[ "$OUTPUT" != *"dummy"* ]]; then
    pass "secret値を出力しない"
  else
    fail "secret値を出力しない" "$OUTPUT"
  fi
}

test_missing_and_symlinked_base_are_controlled() {
  local repo
  repo=$(create_repo base-control)
  rmdir "$repo/.worktrees"

  run_executor preflight fix missing-base \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 10 "$STATUS" "未作成baseは確認待ちになる" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=worktree_base_missing" \
    "base作成警告を返す"

  ln -s "$TEMP_ROOT" "$repo/linked-base"
  run_executor preflight fix linked-base \
    --project-root "$repo" \
    --worktree-base linked-base \
    --allow-unignored-base \
    --skip-dependencies

  assert_status 3 "$STATUS" "symlink baseを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=symlinked_worktree_base" \
    "symlink境界エラーを返す"
}

test_create_base_and_ahead_confirmation() {
  local repo
  local bare="$TEMP_ROOT/ahead-origin.git"
  repo=$(create_repo ahead)
  rmdir "$repo/.worktrees"

  git init -q --bare "$bare"
  git -C "$repo" remote add origin "$bare"
  git -C "$repo" push -q -u origin main
  printf 'ahead\n' >> "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -q -m "Local ahead commit"

  run_executor preflight fix ahead-check \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --create-base \
    --skip-dependencies

  assert_status 10 "$STATUS" "未push commitは確認待ちになる" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=unpushed_commits" \
    "ahead警告を返す"

  run_executor apply fix ahead-check \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --create-base \
    --allow-ahead \
    --skip-dependencies \
    --no-retro

  assert_status 0 "$STATUS" "明示flagでbase作成とaheadを許可する" "$OUTPUT"
  if [[ -d "$repo/.worktrees/fix-ahead-check" ]]; then
    pass "未作成base配下へworktreeを作成する"
  else
    fail "未作成base配下へworktreeを作成する"
  fi
}

test_wrapper_contract_is_provider_neutral() {
  local command_file="$TEST_DIR/../commands/create-worktree.md"
  local skill_file="$TEST_DIR/../skills/create-worktree/SKILL.md"
  local executor_file="$TEST_DIR/../scripts/create-worktree.sh"

  if grep -Fq 'scripts/create-worktree.sh' "$command_file" \
    && grep -Fq 'scripts/create-worktree.sh' "$skill_file"; then
    pass "Claude/Codex wrapperが同じexecutorを参照する"
  else
    fail "Claude/Codex wrapperが同じexecutorを参照する"
  fi

  if ! grep -Eq 'CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|HERDR_' \
    "$executor_file"; then
    pass "executorがproviderとHerdrに依存しない"
  else
    fail "executorがproviderとHerdrに依存しない"
  fi
}

test_conflicting_dependency_options_are_rejected() {
  local repo
  repo=$(create_repo conflicting-options)

  run_executor preflight fix conflict \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --install-dependencies \
    --skip-dependencies

  assert_status 2 "$STATUS" "競合するdependency optionを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=conflicting_dependency_options" \
    "競合optionの安定したエラーを返す"
}

test_state_symlink_is_rejected() {
  local repo
  local outside="$TEMP_ROOT/outside-state"
  repo=$(create_repo state-symlink)
  mkdir -p "$outside"
  ln -s "$outside" "$repo/.tmp"
  git -C "$repo" add .tmp
  git -C "$repo" commit -q -m "Add hostile state symlink"

  run_executor apply fix state-symlink \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 4 "$STATUS" "state symlinkをpartial errorにする" "$OUTPUT"
  assert_contains "$OUTPUT" "error=workflow_state_failed" \
    "state初期化失敗を返す"
  if [[ ! -e "$outside/workflow-state.md" ]] \
    && [[ ! -e "$outside/retro.md" ]]; then
    pass "worktree外のstateを変更しない"
  else
    fail "worktree外のstateを変更しない"
  fi
}

test_secret_detector_failure_is_propagated() {
  local repo
  local fake_plugin="$TEMP_ROOT/failing-detector"
  local missing_plugin="$TEMP_ROOT/missing-detector"
  repo=$(create_repo detector-failure)
  mkdir -p "$fake_plugin/scripts"
  cp "$EXECUTOR" "$fake_plugin/scripts/create-worktree.sh"
  {
    printf '#!/bin/bash\n'
    printf 'exit 7\n'
  } > "$fake_plugin/scripts/detect-secrets.sh"

  run_executor_path "$fake_plugin/scripts/create-worktree.sh" \
    apply fix detector-failure \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 4 "$STATUS" "secret detector失敗をpartial errorにする" "$OUTPUT"
  assert_contains "$OUTPUT" "error=secret_link_failed" \
    "detector失敗を伝播する"

  mkdir -p "$missing_plugin/scripts"
  cp "$EXECUTOR" "$missing_plugin/scripts/create-worktree.sh"
  repo=$(create_repo detector-missing)
  run_executor_path "$missing_plugin/scripts/create-worktree.sh" \
    apply fix detector-missing \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 4 "$STATUS" "secret detector欠落をpartial errorにする" "$OUTPUT"
  assert_contains "$OUTPUT" "error=secret_link_failed" \
    "detector欠落を伝播する"
}

test_glob_worktree_base_is_rejected() {
  local repo
  repo=$(create_repo glob-base)

  run_executor preflight fix glob-base \
    --project-root "$repo" \
    --worktree-base 'unsafe[*]' \
    --allow-unignored-base \
    --skip-dependencies

  assert_status 3 "$STATUS" "globを含むworktree baseを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=unsafe_worktree_base" \
    "glob baseの安定したエラーを返す"
}

test_ahead_check_uses_base_ref() {
  local repo
  local bare="$TEMP_ROOT/base-ref-origin.git"
  repo=$(create_repo base-ref-ahead)
  git init -q --bare "$bare"
  git -C "$repo" remote add origin "$bare"
  git -C "$repo" push -q -u origin main
  printf 'main ahead\n' >> "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -q -m "Main ahead"

  run_executor preflight fix remote-base \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --base-ref origin/main \
    --skip-dependencies

  assert_status 0 "$STATUS" "remote BASE_REFで無関係なaheadを無視する" "$OUTPUT"

  git -C "$repo" branch local-base origin/main
  git -C "$repo" branch --set-upstream-to=origin/main local-base >/dev/null
  git -C "$repo" switch -q local-base
  printf 'local base ahead\n' >> "$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -q -m "Local base ahead"
  git -C "$repo" switch -q main

  run_executor preflight fix local-base \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --base-ref local-base \
    --skip-dependencies

  assert_status 10 "$STATUS" "local BASE_REFのaheadを検出する" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=unpushed_commits" \
    "local BASE_REFのahead警告を返す"
}

test_dependency_check_uses_base_ref() {
  local repo
  repo=$(create_repo dependency-base-ref)
  git -C "$repo" switch -q -c with-lock
  printf '{}\n' > "$repo/package-lock.json"
  git -C "$repo" add package-lock.json
  git -C "$repo" commit -q -m "Add lockfile on base"
  git -C "$repo" switch -q main

  run_executor preflight fix dependency-base \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --base-ref with-lock

  assert_status 10 "$STATUS" "BASE_REFのlockfileを検出する" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=dependency_action_required" \
    "BASE_REF基準のdependency警告を返す"
  assert_contains "$OUTPUT" "dependency_manager=npm" \
    "BASE_REF基準のmanagerを返す"
}

test_apply_creates_worktree_and_state() {
  local repo
  repo=$(create_repo apply)

  run_executor apply fix deterministic-run \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --base-ref HEAD \
    --skip-dependencies \
    --no-retro

  assert_status 0 "$STATUS" "applyが成功する" "$OUTPUT"
  assert_contains "$OUTPUT" "status=created" "created状態を返す"

  if [[ -f "$repo/.worktrees/fix-deterministic-run/.tmp/workflow-state.md" ]]; then
    pass "workflow-stateを作成する"
  else
    fail "workflow-stateを作成する"
  fi

  if [[ ! -e "$repo/.worktrees/fix-deterministic-run/.tmp/retro.md" ]]; then
    pass "--no-retroでretroを作成しない"
  else
    fail "--no-retroでretroを作成しない"
  fi
}

test_dirty_tree_requires_explicit_override() {
  local repo
  repo=$(create_repo dirty)
  printf 'dirty\n' >> "$repo/README.md"

  run_executor preflight fix dirty-tree \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 10 "$STATUS" "dirty treeは確認待ちになる" "$OUTPUT"
  assert_contains "$OUTPUT" "warning=dirty_tree" "dirty警告を返す"

  run_executor preflight fix dirty-tree \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies \
    --allow-dirty

  assert_status 0 "$STATUS" "明示flagでdirtyを許可する" "$OUTPUT"
}

test_unsafe_base_is_rejected() {
  local repo
  repo=$(create_repo unsafe)

  run_executor preflight fix escape \
    --project-root "$repo" \
    --worktree-base ../outside \
    --skip-dependencies

  assert_status 3 "$STATUS" "範囲外パスを拒否する" "$OUTPUT"
  assert_contains "$OUTPUT" "error=unsafe_worktree_base" \
    "安定したエラーコードを返す"
}

test_known_japanese_words_are_deterministic() {
  local repo
  repo=$(create_repo japanese)

  run_executor preflight fix アクション修正 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 0 "$STATUS" "既知の日本語を変換する" "$OUTPUT"
  assert_contains "$OUTPUT" "branch=fix/action-fix" \
    "決定論的な日本語mappingを使う"
}

test_unknown_japanese_requires_slug() {
  local repo
  repo=$(create_repo unknown-japanese)

  run_executor preflight fix 未知語 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --skip-dependencies

  assert_status 3 "$STATUS" "未知の日本語は推測しない" "$OUTPUT"
  assert_contains "$OUTPUT" "error=slug_required" \
    "LLMへslug指定を要求する"

  run_executor preflight fix 未知語 \
    --project-root "$repo" \
    --worktree-base .worktrees \
    --slug explicit-slug \
    --skip-dependencies

  assert_status 0 "$STATUS" "明示slugを受け付ける" "$OUTPUT"
}

test_preflight_is_deterministic
test_apply_creates_worktree_and_state
test_dirty_tree_requires_explicit_override
test_unsafe_base_is_rejected
test_known_japanese_words_are_deterministic
test_unknown_japanese_requires_slug
test_dependency_action_is_explicit
test_spec_and_issue_names
test_missing_spec_preserves_executor_error
test_invalid_task_id_is_rejected
test_secret_link_is_created_without_value_output
test_missing_and_symlinked_base_are_controlled
test_create_base_and_ahead_confirmation
test_wrapper_contract_is_provider_neutral
test_conflicting_dependency_options_are_rejected
test_state_symlink_is_rejected
test_secret_detector_failure_is_propagated
test_glob_worktree_base_is_rejected
test_ahead_check_uses_base_ref
test_dependency_check_uses_base_ref

printf '\npassed=%d failed=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi

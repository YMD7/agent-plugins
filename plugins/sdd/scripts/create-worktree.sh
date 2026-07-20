#!/bin/bash

# SDD create-worktree executor
#
# LLMに依存せず、同じ入力から同じパスとブランチを生成する。
# preflightは変更を加えず、applyはpreflight成功時だけ変更を適用する。

set -uo pipefail

readonly EXIT_USAGE=2
readonly EXIT_VALIDATION=3
readonly EXIT_PARTIAL=4
readonly EXIT_CONFIRMATION=10

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ACTION=""
PREFIX_OR_SPEC=""
TASK_OR_NAME=""
PROJECT_ROOT=""
WORKTREE_BASE=".worktrees"
BASE_REF="HEAD"
EXPLICIT_SLUG=""
ISSUE_TITLE=""
ALLOW_DIRTY=false
ALLOW_AHEAD=false
CREATE_BASE=false
ALLOW_UNIGNORED_BASE=false
DEPENDENCY_MODE="unspecified"
DEPENDENCY_MANAGER="none"
NO_RETRO=false
WARNINGS=()

KIND=""
SLUG=""
WORKTREE_NAME=""
WORKTREE_PATH=""
BRANCH_NAME=""
SPEC_ID=""
TASK_ID=""
ISSUE_NUMBER=""

show_help() {
  cat <<'EOF'
SDDワークツリー作成executor

使い方:
  create-worktree.sh preflight <prefix-or-spec> <task-or-name> [options]
  create-worktree.sh apply <prefix-or-spec> <task-or-name> [options]

オプション:
  --project-root <path>       プロジェクトルート（既定: 現在のGit root）
  --worktree-base <path>      root内の相対配置先（既定: .worktrees）
  --base-ref <ref>            作成元ref（既定: HEAD）
  --slug <slug>               自動slug化できない場合の明示slug
  --issue-title <title>       issueモードのIssueタイトル
  --allow-dirty               dirty treeを明示的に許可
  --allow-ahead               未push commitを明示的に許可
  --create-base               未作成のworktree baseを作成
  --allow-unignored-base      gitignore対象外のbaseを明示的に許可
  --install-dependencies      lockfileに従って依存を初期化
  --skip-dependencies         依存初期化をスキップ
  --no-retro                  retro.mdを初期化しない
  -h, --help                  ヘルプを表示

終了コード:
  0   preflight成功、または作成成功
  2   引数エラー
  3   検証エラー
  4   worktree作成後の初期化エラー
  10  明示的な続行許可が必要
EOF
}

usage_error() {
  printf 'status=error\nerror=%s\n' "$1" >&2
  exit "$EXIT_USAGE"
}

validation_error() {
  printf 'status=error\nerror=%s\n' "$1" >&2
  if [[ -n "${2:-}" ]]; then
    printf 'detail=%s\n' "$2" >&2
  fi
  exit "$EXIT_VALIDATION"
}

append_warning() {
  WARNINGS+=("$1")
}

slugify() {
  local value="$1"

  value="${value//レポート/ report }"
  value="${value//修正/ fix }"
  value="${value//更新/ update }"
  value="${value//追加/ add }"
  value="${value//削除/ delete }"
  value="${value//変更/ change }"
  value="${value//改善/ improve }"
  value="${value//ビュー/ view }"
  value="${value//クエリ/ query }"
  value="${value//データ/ data }"
  value="${value//分析/ analysis }"
  value="${value//集計/ aggregate }"
  value="${value//確定/ confirm }"
  value="${value//アクション/ action }"
  value="${value//ショップ/ shop }"
  value="${value//モール/ mall }"

  value=$(printf '%s' "$value" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-50)
  value=$(printf '%s' "$value" | sed -E 's/-+$//')
  printf '%s\n' "$value"
}

validate_slug() {
  local value="$1"
  [[ ${#value} -le 50 ]] || return 1
  [[ "$value" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

validate_prefix() {
  [[ "$1" =~ ^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$ ]]
}

validate_relative_base() {
  local value="$1"

  case "$value" in
    ""|.|..|/*|./*|../*|*/.|*/..|*/./*|*/../*|.git|.git/*|*/.git|*/.git/*)
      return 1
      ;;
  esac
  [[ "$value" != *$'\n'* ]]
}

validate_worktree_base() {
  local value="$1"
  local components=()
  local component

  validate_relative_base "$value" || return 1
  IFS='/' read -r -a components <<< "$value"
  for component in "${components[@]}"; do
    [[ "$component" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  done
  return 0
}

path_has_symlink_component() {
  local root="$1"
  local relative="$2"
  local current="$root"
  local components=()
  local component

  IFS='/' read -r -a components <<< "$relative"
  for component in "${components[@]}"; do
    current="$current/$component"
    if [[ -L "$current" ]]; then
      return 0
    fi
  done
  return 1
}

resolve_project_root() {
  local candidate="$PROJECT_ROOT"

  if [[ -z "$candidate" ]]; then
    candidate=$(git rev-parse --show-toplevel 2>/dev/null) \
      || validation_error not_git_repository
  fi
  [[ -d "$candidate" ]] || validation_error project_root_not_found "$candidate"

  PROJECT_ROOT=$(cd "$candidate" 2>/dev/null && pwd -P) \
    || validation_error project_root_not_found "$candidate"
  git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 \
    || validation_error not_git_repository "$PROJECT_ROOT"
}

resolve_spec_slug() {
  local spec_id="$1"
  local scope_number="${spec_id##*-S}"
  local blueprint_id="${spec_id%%-S*}"
  local matches=()
  local blueprints=()
  local scopes=()

  shopt -s nullglob
  matches=("$PROJECT_ROOT/spec/specs/${spec_id}-"*)
  if [[ ${#matches[@]} -eq 1 ]] && [[ -d "${matches[0]}" ]]; then
    basename "${matches[0]}" | sed "s/^${spec_id}-//"
    return 0
  fi
  if [[ ${#matches[@]} -gt 1 ]]; then
    validation_error ambiguous_spec_directory "$spec_id"
  fi

  blueprints=("$PROJECT_ROOT/spec/blueprints/${blueprint_id}-"*)
  if [[ ${#blueprints[@]} -ne 1 ]] || [[ ! -d "${blueprints[0]}" ]]; then
    validation_error spec_not_found "$spec_id"
  fi
  scopes=("${blueprints[0]}/scopes/${scope_number}-"*.md)
  if [[ ${#scopes[@]} -ne 1 ]]; then
    validation_error scope_not_found "$spec_id"
  fi
  basename "${scopes[0]}" .md | sed "s/^${scope_number}-//"
}

normalize_task_id() {
  local value="$1"

  if [[ "$value" =~ ^[Tt]([0-9]+([.][0-9]+)*)$ ]]; then
    printf 'T%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^[Pp][Hh]([0-9]+)$ ]]; then
    printf 'Ph%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^[Pp][Hh][Aa][Ss][Ee]([0-9]+)$ ]]; then
    printf 'Ph%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^[0-9]+([.][0-9]+)*$ ]]; then
    printf 'T%s\n' "$value"
  else
    validation_error invalid_task_id "$value"
  fi
}

resolve_slug() {
  local source="$1"

  if [[ -n "$EXPLICIT_SLUG" ]]; then
    validate_slug "$EXPLICIT_SLUG" \
      || validation_error invalid_slug "$EXPLICIT_SLUG"
    SLUG="$EXPLICIT_SLUG"
    return
  fi

  SLUG=$(slugify "$source")
  if [[ -z "$SLUG" ]]; then
    validation_error slug_required
  fi
  validate_slug "$SLUG" || validation_error invalid_slug "$SLUG"
}

derive_names() {
  case "$PREFIX_OR_SPEC" in
    sdd)
      KIND="sdd"
      SPEC_ID="$TASK_OR_NAME"
      [[ "$SPEC_ID" =~ ^B[0-9][0-9]-S[0-9][0-9]$ ]] \
        || validation_error invalid_spec_id "$SPEC_ID"
      if [[ -n "$EXPLICIT_SLUG" ]]; then
        resolve_slug "$EXPLICIT_SLUG"
      else
        SLUG=$(resolve_spec_slug "$SPEC_ID") || exit $?
        validate_slug "$SLUG" || validation_error invalid_slug "$SLUG"
      fi
      WORKTREE_NAME="sdd-${SPEC_ID}-${SLUG}"
      BRANCH_NAME="sdd/${SPEC_ID}-${SLUG}"
      ;;
    issue)
      KIND="issue"
      ISSUE_NUMBER="$TASK_OR_NAME"
      [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] \
        || validation_error invalid_issue_number "$ISSUE_NUMBER"
      if [[ -z "$ISSUE_TITLE" ]] && [[ -z "$EXPLICIT_SLUG" ]]; then
        validation_error issue_title_required
      fi
      resolve_slug "${ISSUE_TITLE:-$EXPLICIT_SLUG}"
      WORKTREE_NAME="issue-${ISSUE_NUMBER}-${SLUG}"
      BRANCH_NAME="issue/${ISSUE_NUMBER}-${SLUG}"
      ;;
    B[0-9][0-9]-S[0-9][0-9])
      KIND="spec"
      SPEC_ID="$PREFIX_OR_SPEC"
      TASK_ID=$(normalize_task_id "$TASK_OR_NAME") || exit $?
      if [[ -n "$EXPLICIT_SLUG" ]]; then
        resolve_slug "$EXPLICIT_SLUG"
      else
        SLUG=$(resolve_spec_slug "$SPEC_ID") || exit $?
        validate_slug "$SLUG" || validation_error invalid_slug "$SLUG"
      fi
      WORKTREE_NAME="spec${SPEC_ID}-${TASK_ID}"
      BRANCH_NAME="spec/${SPEC_ID}-${SLUG}/${TASK_ID}"
      ;;
    *)
      KIND="generic"
      validate_prefix "$PREFIX_OR_SPEC" \
        || validation_error invalid_prefix "$PREFIX_OR_SPEC"
      resolve_slug "$TASK_OR_NAME"
      WORKTREE_NAME="${PREFIX_OR_SPEC}-${SLUG}"
      BRANCH_NAME="${PREFIX_OR_SPEC}/${SLUG}"
      ;;
  esac

  git check-ref-format --branch "$BRANCH_NAME" >/dev/null 2>&1 \
    || validation_error invalid_branch_name "$BRANCH_NAME"
}

check_preflight() {
  local base_path="$PROJECT_ROOT/$WORKTREE_BASE"
  local base_branch=""
  local upstream=""
  local ahead_count=0

  validate_worktree_base "$WORKTREE_BASE" \
    || validation_error unsafe_worktree_base "$WORKTREE_BASE"
  if path_has_symlink_component "$PROJECT_ROOT" "$WORKTREE_BASE"; then
    validation_error symlinked_worktree_base "$WORKTREE_BASE"
  fi

  if [[ -e "$base_path" ]] && [[ ! -d "$base_path" ]]; then
    validation_error worktree_base_not_directory "$base_path"
  fi
  if [[ ! -d "$base_path" ]] && ! $CREATE_BASE; then
    append_warning worktree_base_missing
  fi
  if ! git -C "$PROJECT_ROOT" check-ignore -q -- "$WORKTREE_BASE/"; then
    if ! $ALLOW_UNIGNORED_BASE; then
      append_warning worktree_base_unignored
    fi
  fi

  WORKTREE_PATH="$base_path/$WORKTREE_NAME"
  if [[ -e "$WORKTREE_PATH" ]] || [[ -L "$WORKTREE_PATH" ]]; then
    validation_error worktree_path_exists "$WORKTREE_PATH"
  fi
  if git -C "$PROJECT_ROOT" show-ref --verify --quiet \
    "refs/heads/$BRANCH_NAME"; then
    validation_error branch_exists "$BRANCH_NAME"
  fi
  if git -C "$PROJECT_ROOT" worktree list --porcelain \
    | grep -Fqx "worktree $WORKTREE_PATH"; then
    validation_error worktree_registered "$WORKTREE_PATH"
  fi

  [[ "$BASE_REF" != -* ]] || validation_error invalid_base_ref "$BASE_REF"
  git -C "$PROJECT_ROOT" rev-parse --verify \
    "${BASE_REF}^{commit}" >/dev/null 2>&1 \
    || validation_error base_ref_not_found "$BASE_REF"

  DEPENDENCY_MANAGER=$(detect_dependency_manager_in_ref)

  if [[ -n "$(git -C "$PROJECT_ROOT" status --porcelain)" ]] \
    && ! $ALLOW_DIRTY; then
    append_warning dirty_tree
  fi

  if [[ "$BASE_REF" == "HEAD" ]]; then
    base_branch=$(git -C "$PROJECT_ROOT" symbolic-ref \
      --quiet --short HEAD 2>/dev/null || true)
  elif [[ "$BASE_REF" == refs/heads/* ]]; then
    base_branch="${BASE_REF#refs/heads/}"
  elif git -C "$PROJECT_ROOT" show-ref --verify --quiet \
    "refs/heads/$BASE_REF"; then
    base_branch="$BASE_REF"
  fi

  if [[ -n "$base_branch" ]]; then
    upstream=$(git -C "$PROJECT_ROOT" rev-parse \
      --abbrev-ref --symbolic-full-name \
      "${base_branch}@{upstream}" 2>/dev/null || true)
  fi
  if [[ -n "$upstream" ]]; then
    ahead_count=$(git -C "$PROJECT_ROOT" rev-list --count \
      "$upstream..$BASE_REF" 2>/dev/null || printf '0')
    if [[ "$ahead_count" -gt 0 ]] && ! $ALLOW_AHEAD; then
      append_warning unpushed_commits
    fi
  fi

  if [[ "$DEPENDENCY_MODE" == "unspecified" ]] \
    && [[ "$DEPENDENCY_MANAGER" != "none" ]]; then
    append_warning dependency_action_required
  fi
}

emit_plan() {
  local status="$1"
  local warning

  printf 'status=%s\n' "$status"
  printf 'kind=%s\n' "$KIND"
  printf 'project_root=%s\n' "$PROJECT_ROOT"
  printf 'worktree_path=%s\n' "$WORKTREE_PATH"
  printf 'branch=%s\n' "$BRANCH_NAME"
  printf 'base_ref=%s\n' "$BASE_REF"
  printf 'dependency_manager=%s\n' "$DEPENDENCY_MANAGER"
  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    for warning in "${WARNINGS[@]}"; do
      printf 'warning=%s\n' "$warning"
    done
  fi
}

detect_dependency_manager_in_ref() {
  if git -C "$PROJECT_ROOT" cat-file -e \
    "${BASE_REF}:bun.lock" 2>/dev/null \
    || git -C "$PROJECT_ROOT" cat-file -e \
      "${BASE_REF}:bun.lockb" 2>/dev/null; then
    printf 'bun\n'
  elif git -C "$PROJECT_ROOT" cat-file -e \
    "${BASE_REF}:pnpm-lock.yaml" 2>/dev/null; then
    printf 'pnpm\n'
  elif git -C "$PROJECT_ROOT" cat-file -e \
    "${BASE_REF}:yarn.lock" 2>/dev/null; then
    printf 'yarn\n'
  elif git -C "$PROJECT_ROOT" cat-file -e \
    "${BASE_REF}:package-lock.json" 2>/dev/null; then
    printf 'npm\n'
  else
    printf 'none\n'
  fi
}

detect_dependency_manager_in_tree() {
  local root="$1"

  if [[ -f "$root/bun.lock" ]] || [[ -f "$root/bun.lockb" ]]; then
    printf 'bun\n'
  elif [[ -f "$root/pnpm-lock.yaml" ]]; then
    printf 'pnpm\n'
  elif [[ -f "$root/yarn.lock" ]]; then
    printf 'yarn\n'
  elif [[ -f "$root/package-lock.json" ]]; then
    printf 'npm\n'
  else
    printf 'none\n'
  fi
}

prepare_new_file_parent() {
  local relative="$1"
  local destination="$WORKTREE_PATH/$relative"
  local parent="${destination%/*}"
  local worktree_real
  local parent_real

  validate_relative_base "$relative" || return 1
  [[ ! -e "$destination" ]] && [[ ! -L "$destination" ]] || return 1
  if path_has_symlink_component "$WORKTREE_PATH" "$relative"; then
    return 1
  fi

  mkdir -p "$parent" || return 1
  worktree_real=$(cd "$WORKTREE_PATH" 2>/dev/null && pwd -P) || return 1
  parent_real=$(cd "$parent" 2>/dev/null && pwd -P) || return 1
  case "$parent_real" in
    "$worktree_real"|"$worktree_real"/*) ;;
    *) return 1 ;;
  esac
  [[ ! -L "$destination" ]]
}

create_secret_links() {
  local detected=""
  local source
  local relative
  local destination
  local count=0

  if [[ ! -x "$SCRIPT_DIR/detect-secrets.sh" ]] \
    && [[ ! -f "$SCRIPT_DIR/detect-secrets.sh" ]]; then
    return 1
  fi

  detected=$(bash "$SCRIPT_DIR/detect-secrets.sh" "$PROJECT_ROOT" 2) \
    || return 1

  while IFS= read -r source; do
    [[ -n "$source" ]] || continue
    case "$source" in
      "$PROJECT_ROOT"/*) ;;
      *) continue ;;
    esac
    relative="${source#"$PROJECT_ROOT"/}"
    destination="$WORKTREE_PATH/$relative"
    if [[ ! -e "$destination" ]] && [[ ! -L "$destination" ]]; then
      prepare_new_file_parent "$relative" || return 1
      ln -s "$source" "$destination" || return 1
      count=$((count + 1))
    fi
  done <<< "$detected"

  printf '%s\n' "$count"
}

write_workflow_state() {
  local state_dir="$WORKTREE_PATH/.tmp"
  local workflow="implementation"
  local next="作業開始"

  if [[ "$KIND" == "sdd" ]]; then
    workflow="spec-generation"
    next="ドキュメント生成を開始"
  elif [[ "$KIND" == "spec" ]] || [[ "$KIND" == "issue" ]]; then
    next="/plan-task で実装計画を作成"
  fi

  prepare_new_file_parent ".tmp/workflow-state.md" || return 1
  if ! $NO_RETRO; then
    prepare_new_file_parent ".tmp/retro.md" || return 1
  fi
  {
    printf '# Workflow State\n\n'
    printf '## Context\n\n'
    printf -- '- workflow: %s\n' "$workflow"
    printf -- '- type: %s\n' "$KIND"
    [[ -z "$SPEC_ID" ]] || printf -- '- spec: %s\n' "$SPEC_ID"
    [[ -z "$TASK_ID" ]] || printf -- '- phase: %s\n' "$TASK_ID"
    [[ -z "$ISSUE_NUMBER" ]] || printf -- '- issue: %s\n' "$ISSUE_NUMBER"
    printf -- '- worktree: %s/%s\n' "$WORKTREE_BASE" "$WORKTREE_NAME"
    printf -- '- branch: %s\n\n' "$BRANCH_NAME"
    printf '## Current Step\n\n'
    printf -- '- step: create-worktree\n'
    printf -- '- substep: 完了\n'
    printf -- '- next: %s\n' "$next"
  } > "$state_dir/workflow-state.md" || return 1

  if ! $NO_RETRO; then
    : > "$state_dir/retro.md" || return 1
  fi
}

install_dependencies() {
  local manager

  manager=$(detect_dependency_manager_in_tree "$WORKTREE_PATH")
  [[ "$manager" == "$DEPENDENCY_MANAGER" ]] || return 3

  if [[ "$DEPENDENCY_MODE" == "skip" ]]; then
    printf 'skipped\n'
    return 0
  fi

  if [[ "$manager" == "bun" ]]; then
    command -v bun >/dev/null 2>&1 || return 2
    bun install --cwd "$WORKTREE_PATH" >&2 || return 1
  elif [[ "$manager" == "pnpm" ]]; then
    command -v pnpm >/dev/null 2>&1 || return 2
    pnpm --dir "$WORKTREE_PATH" install >&2 || return 1
  elif [[ "$manager" == "yarn" ]]; then
    command -v yarn >/dev/null 2>&1 || return 2
    yarn --cwd "$WORKTREE_PATH" install >&2 || return 1
  elif [[ "$manager" == "npm" ]]; then
    command -v npm >/dev/null 2>&1 || return 2
    npm --prefix "$WORKTREE_PATH" install >&2 || return 1
  fi

  if [[ "$manager" == "none" ]]; then
    printf 'not_applicable\n'
  else
    printf 'installed_%s\n' "$manager"
  fi
}

apply_changes() {
  local secret_count=0
  local dependency_status=""
  local dependency_exit=0

  if [[ ! -d "$PROJECT_ROOT/$WORKTREE_BASE" ]]; then
    mkdir -p "$PROJECT_ROOT/$WORKTREE_BASE" \
      || validation_error worktree_base_create_failed
  fi

  git -C "$PROJECT_ROOT" worktree add \
    -b "$BRANCH_NAME" -- "$WORKTREE_PATH" "$BASE_REF" >&2 \
    || validation_error git_worktree_add_failed

  secret_count=$(create_secret_links) || {
    emit_plan created_partial
    printf 'error=secret_link_failed\n' >&2
    exit "$EXIT_PARTIAL"
  }
  write_workflow_state || {
    emit_plan created_partial
    printf 'error=workflow_state_failed\n' >&2
    exit "$EXIT_PARTIAL"
  }

  dependency_status=$(install_dependencies)
  dependency_exit=$?
  if [[ "$dependency_exit" -ne 0 ]]; then
    emit_plan created_partial
    if [[ "$dependency_exit" -eq 2 ]]; then
      printf 'error=package_manager_not_found\n' >&2
    elif [[ "$dependency_exit" -eq 3 ]]; then
      printf 'error=dependency_layout_changed\n' >&2
    else
      printf 'error=dependency_install_failed\n' >&2
    fi
    exit "$EXIT_PARTIAL"
  fi

  emit_plan created
  printf 'secret_links=%s\n' "$secret_count"
  printf 'dependency_status=%s\n' "$dependency_status"
}

parse_arguments() {
  if [[ $# -eq 1 ]] && [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_help
    exit 0
  fi
  [[ $# -ge 3 ]] || usage_error missing_arguments

  ACTION="$1"
  PREFIX_OR_SPEC="$2"
  TASK_OR_NAME="$3"
  shift 3

  case "$ACTION" in
    preflight|apply) ;;
    *) usage_error invalid_action ;;
  esac

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-root|--worktree-base|--base-ref|--slug|--issue-title)
        [[ $# -ge 2 ]] || usage_error "missing_value_${1#--}"
        case "$1" in
          --project-root) PROJECT_ROOT="$2" ;;
          --worktree-base) WORKTREE_BASE="$2" ;;
          --base-ref) BASE_REF="$2" ;;
          --slug) EXPLICIT_SLUG="$2" ;;
          --issue-title) ISSUE_TITLE="$2" ;;
        esac
        shift 2
        ;;
      --allow-dirty) ALLOW_DIRTY=true; shift ;;
      --allow-ahead) ALLOW_AHEAD=true; shift ;;
      --create-base) CREATE_BASE=true; shift ;;
      --allow-unignored-base) ALLOW_UNIGNORED_BASE=true; shift ;;
      --install-dependencies)
        if [[ "$DEPENDENCY_MODE" == "skip" ]]; then
          usage_error conflicting_dependency_options
        fi
        DEPENDENCY_MODE="install"
        shift
        ;;
      --skip-dependencies)
        if [[ "$DEPENDENCY_MODE" == "install" ]]; then
          usage_error conflicting_dependency_options
        fi
        DEPENDENCY_MODE="skip"
        shift
        ;;
      --no-retro) NO_RETRO=true; shift ;;
      -h|--help) show_help; exit 0 ;;
      *) usage_error unknown_option ;;
    esac
  done
}

main() {
  parse_arguments "$@"
  resolve_project_root
  derive_names
  check_preflight

  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    emit_plan needs_confirmation
    exit "$EXIT_CONFIRMATION"
  fi
  if [[ "$ACTION" == "preflight" ]]; then
    emit_plan ready
    exit 0
  fi
  apply_changes
}

main "$@"

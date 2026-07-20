#!/bin/bash
# detect-secrets.sh — gitignore されている秘匿ファイルを検出してパスを出力する
#
# create-worktree（シンボリックリンク作成）と cleanup-worktree（回収）の両方から参照される。
# 検出ロジックを一箇所に集約することで両者の齟齬を防ぐ。
#
# Usage:
#   bash ${CLAUDE_PLUGIN_ROOT}/scripts/detect-secrets.sh <directory> [max-depth]
#
# Arguments:
#   directory   検索対象ディレクトリ（必須、絶対パス推奨）
#   max-depth   find の深度制限（省略時は無制限）
#
# Output:
#   マッチしたファイルの絶対パス（1行1ファイル）
#
# Design:
#   1. ファイル名パターンで一次フィルタ（よくある秘匿ファイル名）
#   2. `git check-ignore` で二次フィルタ（プロジェクトの .gitignore が秘匿宣言）
#   AND 条件により、非秘匿ファイル（例: 公開鍵、.env.example）の誤検出を防ぐ。

set -euo pipefail

DIR="${1:?Usage: $0 <directory> [max-depth]}"
MAX_DEPTH="${2:-}"

if [[ ! -d "$DIR" ]]; then
  echo "Error: directory not found: $DIR" >&2
  exit 1
fi

# 絶対パスに正規化
DIR="$(cd "$DIR" && pwd)"

# find の -maxdepth 引数
depth_arg=()
if [[ -n "$MAX_DEPTH" ]]; then
  depth_arg=(-maxdepth "$MAX_DEPTH")
fi

# 秘匿ファイルパターン + gitignore フィルタ
find "$DIR" ${depth_arg[@]+"${depth_arg[@]}"} -type f \
  \( \
    \( -name ".env*" ! -name "*.example" \) -o \
    -name "*.key" -o \
    -name "*.pem" -o \
    -name "*.p8" -o \
    -name "*.p12" -o \
    -name "*.pfx" -o \
    -name "*credentials*.json" -o \
    -name "*service-key.json" -o \
    -name "*-sa-key.json" -o \
    -name ".secret*" -o \
    -path "*/.vercel/project.json" \
  \) 2>/dev/null | while IFS= read -r file; do
  if git -C "$DIR" check-ignore "$file" >/dev/null 2>&1; then
    echo "$file"
  fi
done

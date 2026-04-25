#!/usr/bin/env bash
#
# Asserts there is exactly one `react` install resolved at the user-facing
# locations (root + each workspace). Multiple copies cause React hooks to
# fail at runtime with "Invalid hook call" / "Cannot read properties of
# null (reading 'useRef')".
#
# Bun symlinks every workspace's `node_modules/react` into a shared
# `.bun/react@VERSION/...` content cache. Counting realpaths catches the
# real-failure case (different versions) without flagging the harmless
# multi-symlink-same-target case.
#
# Run in CI and as a predev so the dual-React regression is caught
# before it hits the browser.

set -euo pipefail

shopt -s nullglob

candidates=(
  node_modules/react/package.json
  packages/*/node_modules/react/package.json
)

real_paths=()
for f in "${candidates[@]}"; do
  if [ -e "$f" ]; then
    real_paths+=("$(cd "$(dirname "$f")" && pwd -P)")
  fi
done

# Dedupe
unique=$(printf '%s\n' "${real_paths[@]}" | sort -u)
count=$(printf '%s' "$unique" | grep -c . || true)

if [ "$count" -ne 1 ]; then
  echo "ERROR: expected exactly 1 react install, found $count:"
  printf '  %s\n' $unique
  echo
  echo "Multiple copies cause hook dispatcher mismatches. Add"
  echo "vite.resolve.dedupe = ['react', 'react-dom'] in the consumer"
  echo "build, or rerun bun install after deleting the stale copies."
  exit 1
fi

echo "OK: 1 react install resolved"

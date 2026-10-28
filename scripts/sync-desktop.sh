#!/usr/bin/env bash
# Copy Aurora's shared UI from the desktop repo into web/.
# Usage: bash scripts/sync-desktop.sh [path-to-Aurora-desktop-repo]   (default: ../Aurora or ../aurora)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-}"
if [ -z "$src" ]; then for c in "$here/../Aurora" "$here/../aurora"; do [ -d "$c/src/renderer" ] && src="$c" && break; done; fi
[ -d "$src/src/renderer" ] || { echo "Aurora desktop repo not found. Pass its path." >&2; exit 1; }
rm -rf "$here/web" && cp -r "$src/src/renderer" "$here/web"
rev=$(git -C "$src" rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "$rev" > "$here/web/.desktop-rev"
echo "web/ now matches Aurora desktop @ $rev"

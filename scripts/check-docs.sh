#!/usr/bin/env bash
# Fails when the public docs point at files that are not tracked, or carry words the public surface must not.
set -euo pipefail
cd "$(dirname "$0")/.."
bad=0
tracked() { git ls-files --error-unmatch "$1" >/dev/null 2>&1 || test -f "$1"; }
for f in README.md AGENTS.md web/README.md; do
  [ -f "$f" ] || { echo "missing $f"; bad=1; continue; }
  dir="$(dirname "$f")"
  # relative markdown links and backticked paths that look like repo files
  { grep -o '](\([^)#]*\))' "$f" | sed 's/^](//;s/)$//' | grep -v '^[a-z]*:' || true
    grep -o '`[A-Za-z0-9_-]*/[A-Za-z0-9_./-]*\.\(md\|sh\|py\|ts\|rs\|json\|yml\|html\|js\)`' "$f" | tr -d '`' || true; } | sort -u | while read -r p; do
    case "$p" in *\**|*\<*|.env|*/.env*) continue;; esac
    if ! tracked "$dir/$p" && ! tracked "$p"; then echo "$f links to $p which does not exist"; echo bad >> /tmp/check-docs.bad.$$; fi
  done
done
if [ -f /tmp/check-docs.bad.$$ ]; then rm -f /tmp/check-docs.bad.$$; bad=1; fi
# em dashes and prize amounts in tracked markdown
if git ls-files '*.md' | xargs grep -n ' — \| -- ' 2>/dev/null | grep -v '^docs/TESTS.md' | head -5 | grep .; then bad=1; fi
if git ls-files '*.md' | xargs grep -nE '\$[0-9][0-9,]*[kKmM]?( |\.|,|$)' 2>/dev/null | grep -v '^docs/PRIOR-ART.md' | head -5 | grep .; then bad=1; fi
exit "$bad"

# source before building: shared caches and a cargo target dir private to this repo
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/target}"

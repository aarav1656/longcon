# source before building: caches on the SSD, a target dir private to this repo so lanes do not share a lock
. /Volumes/PortableSSD/near/env.sh
export CARGO_TARGET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/target"

#!/usr/bin/env bash
# Build the contract wasm with the on-chain host functions selected.
# near-sdk 5.30 needs `--cfg near`; cargo-near 0.16 does not pass it, so `cargo near build` yields a
# wasm whose panics carry no message and whose hashes run in guest code. This builds with the cfg, then lowers
# post-MVP wasm ops with wasm-opt.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/scripts/env.sh"
out="${1:-$root/target/wasm}"
mkdir -p "$out"
(cd "$root/contract" && RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --release --target wasm32-unknown-unknown --lib)
raw="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/longcon.wasm"
# recent rustc and std emit bulk-memory and sign-ext ops that the NEAR VM rejects, so lower them
wasm-opt "$raw" --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int \
  --llvm-memory-copy-fill-lowering --signext-lowering --llvm-nontrapping-fptoint-lowering -Oz --strip-debug -o "$out/longcon.wasm"
ls -l "$out/longcon.wasm"

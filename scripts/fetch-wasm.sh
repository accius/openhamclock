#!/bin/bash
# ============================================================
# fetch-wasm.sh — download P.533 WASM from the wasm-latest release
# ============================================================
# The build-wasm.yml workflow publishes p533.{mjs,wasm,sha256}
# to the `wasm-latest` GitHub Release on every push to main/Staging.
# We curl the three files into public/wasm/ so Vite bundles them
# into dist/wasm/ for serving at /wasm/p533.{mjs,wasm}.
#
# Public repo → no auth needed. Only curl is required.
#
# Failure mode: if any download fails, the script exits 0 with a
# warning. Runtime falls back to /api/bands (proppy REST) and then
# the built-in heuristic, so builds still ship a working app.
# ============================================================

set -uo pipefail

REPO="${WASM_REPO:-accius/openhamclock}"
TAG="${WASM_RELEASE_TAG:-wasm-latest}"
DEST_DIR="public/wasm"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"

warn() { echo "⚠  fetch-wasm: $1 — skipping (runtime will use REST fallback)" >&2; exit 0; }

command -v curl >/dev/null 2>&1 || warn "curl not installed"

mkdir -p "$DEST_DIR"

echo "→ fetch-wasm: downloading from $BASE_URL..."
for f in p533.mjs p533.wasm p533.sha256; do
  curl -sfL "$BASE_URL/$f" -o "$DEST_DIR/$f" || warn "failed to download $f"
done

# Verify sha256 using whichever tool is available (sha256sum on Linux/Alpine,
# shasum on macOS). We don't hard-fail if neither is present — missing tooling
# shouldn't block a build, but a mismatch still does.
if [ -f "$DEST_DIR/p533.sha256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$DEST_DIR" && sha256sum -c p533.sha256 >/dev/null 2>&1) \
      || warn "sha256 mismatch on downloaded WASM"
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$DEST_DIR" && shasum -a 256 -c p533.sha256 >/dev/null 2>&1) \
      || warn "sha256 mismatch on downloaded WASM"
  fi
fi

echo "✓ fetch-wasm: installed to $DEST_DIR/"
ls -lh "$DEST_DIR/" | grep -E 'p533\.(mjs|wasm)$' || true

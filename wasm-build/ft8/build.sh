#!/usr/bin/env bash
#
# Compile kgoba/ft8_lib (MIT) + ft8_wrapper.c to WebAssembly for the Decoder
# panel's FT8 tab.
#
# Usage:
#   ./build.sh               # WASM build into ../dist/ft8.{mjs,wasm,sha256}
#   ./build.sh --native      # native build (cc) of the wrapper + test driver,
#                            # decode ft8_lib's test WAVs and score them against
#                            # WSJT-X (no Emscripten needed)
#   ./build.sh --clean       # remove the fetched source first
#
# Requires Emscripten (emcc) for the WASM build. See README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Pinned upstream commit — bump deliberately (and re-run --native).
FT8_REPO="https://github.com/kgoba/ft8_lib"
FT8_COMMIT="9fec6ca39886edbf96f4f5e71edc76da5074e871"
SRC_DIR="../src/ft8_lib-${FT8_COMMIT:0:12}"
DIST_DIR="../dist"

MODE="wasm"
for arg in "$@"; do
  case "$arg" in
    --clean) rm -rf "$SRC_DIR" ;;
    --native) MODE="native" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ── Fetch source ──────────────────────────────────────────────────────────────
if [[ ! -d "$SRC_DIR" ]]; then
  echo "[ft8] Downloading ft8_lib ${FT8_COMMIT:0:12}…"
  mkdir -p ../src
  curl -fsSL -o ../src/ft8_lib.tar.gz "${FT8_REPO}/archive/${FT8_COMMIT}.tar.gz"
  tar -xzf ../src/ft8_lib.tar.gz -C ../src
  mv "../src/ft8_lib-${FT8_COMMIT}" "$SRC_DIR"
  rm ../src/ft8_lib.tar.gz
fi

SOURCES=(
  "$SRC_DIR/ft8/constants.c"
  "$SRC_DIR/ft8/crc.c"
  "$SRC_DIR/ft8/decode.c"
  "$SRC_DIR/ft8/encode.c"
  "$SRC_DIR/ft8/ldpc.c"
  "$SRC_DIR/ft8/message.c"
  "$SRC_DIR/ft8/text.c"
  "$SRC_DIR/common/monitor.c"
  "$SRC_DIR/fft/kiss_fft.c"
  "$SRC_DIR/fft/kiss_fftr.c"
  "ft8_wrapper.c"
)

# HAVE_STPCPY + gnu11: use libc stpcpy (POSIX, so not declared under strict -std=c11 —
# emscripten errors on the implicit declaration).
# LOG_PRINTF: silence ft8_lib's informational logging ("Block size = …").
CFLAGS=(-O3 -DNDEBUG -DHAVE_STPCPY '-DLOG_PRINTF(...)=((void)0)' -I"$SRC_DIR" -std=gnu11)

if [[ "$MODE" == "native" ]]; then
  CC="${CC:-cc}"
  OUT="../src/ft8_native_test"
  echo "[ft8] Native build with ${CC}…"
  "$CC" "${CFLAGS[@]}" -Wall -Wno-unused-function -o "$OUT" \
    "${SOURCES[@]}" native_test.c "$SRC_DIR/common/wave.c" -lm
  RESULTS="../src/ft8_native_results.jsonl"
  "$OUT" "$SRC_DIR"/test/wav/*.wav > "$RESULTS"
  node compare.mjs "$RESULTS"
  exit 0
fi

if ! command -v emcc >/dev/null; then
  echo "error: emcc not found on PATH. Install Emscripten and run 'source ./emsdk_env.sh'." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

# -sMODULARIZE/EXPORT_ES6  factory function the worker imports dynamically
# -sALLOW_MEMORY_GROWTH    a 15 s slot at 12 kHz is 720 KB of floats plus the waterfall
# -sENVIRONMENT            web/worker for the app, node for the CI smoke test
# Module.HEAPF32 is present by default on emscripten 3.1.x; the JS glue
# (src/utils/ft8Wasm.js) falls back to wasmMemory if a newer emscripten drops it.
LDFLAGS=(
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createFt8Module
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=16777216
  -sSTACK_SIZE=262144
  -sFILESYSTEM=0
  -sEXPORTED_FUNCTIONS=_ft8_decode,_ft8_free,_ft8_reset,_malloc,_free
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString
  -lm
)

echo "[ft8] Compiling ${#SOURCES[@]} translation units with emcc..."
emcc "${CFLAGS[@]}" "${SOURCES[@]}" "${LDFLAGS[@]}" -o "$DIST_DIR/ft8.mjs"

if command -v shasum >/dev/null; then
  (cd "$DIST_DIR" && shasum -a 256 ft8.mjs ft8.wasm > ft8.sha256)
else
  (cd "$DIST_DIR" && sha256sum ft8.mjs ft8.wasm > ft8.sha256)
fi

echo "[ft8] Done."
ls -lh "$DIST_DIR"/ft8.*

#!/usr/bin/env bash
#
# Compile ITU-R P.533-14 (libp533 + libp372 + ITURHFProp) to WebAssembly.
# Source is fetched from the ITU-R Study Group 3 GitHub release tag v14.3.
#
# Usage:
#   ./build.sh              # build into ./dist/
#   ./build.sh --clean      # remove src/ and dist/ first
#
# Requires Emscripten in PATH (emcc). See README.md for setup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ITU_REPO="https://github.com/ITU-R-Study-Group-3/ITU-R-HF"
ITU_TAG="v14.3"
SRC_DIR="src/ITU-R-HF-${ITU_TAG#v}"
DIST_DIR="dist"

if [[ "${1:-}" == "--clean" ]]; then
  rm -rf "src/ITU-R-HF-${ITU_TAG#v}" "$DIST_DIR"
fi

if ! command -v emcc >/dev/null; then
  echo "error: emcc not found on PATH. Install Emscripten and run 'source ./emsdk_env.sh'." >&2
  exit 1
fi

mkdir -p src "$DIST_DIR"

# ── Fetch source ──────────────────────────────────────────────────────────────
if [[ ! -d "$SRC_DIR" ]]; then
  echo "[build] Downloading ITU-R-HF ${ITU_TAG} source…"
  curl -fsSL -o src/source.tar.gz "${ITU_REPO}/archive/refs/tags/${ITU_TAG}.tar.gz"
  tar -xzf src/source.tar.gz -C src
  rm src/source.tar.gz

  # ── Patch P533.c for static linking on Emscripten ───────────────────────────
  # Upstream loads libp372 via dlopen() on Linux/macOS. In our WASM build the
  # P.372 sources are statically linked into the same module, so replace the
  # dynamic-load block with direct function-pointer assignment. Keeping the
  # patch inline (no external .patch file) makes it easier to retarget when
  # upstream bumps the tag. Python handles the multi-line replace reliably.
  python3 - <<PYEOF
from pathlib import Path
p533 = Path("$SRC_DIR/P533/Src/P533/P533.c")
src = p533.read_text()

old_block = """\t#elif __linux__ || __APPLE__
\t\tvoid * hLib;
\t\thLib = dlopen("libp372.so", RTLD_NOW);
\t\tif (!hLib) {
\t\t\tprintf("Couldn't load libp372.so, exiting.\\n");
\t\t\texit(1);
\t\t}
\t\tdllP372Version = dlsym(hLib, "P372Version");
\t\tdllP372CompileTime = dlsym(hLib, "P372CompileTime");
\t\tdllNoise = dlsym(hLib, "Noise");
\t\tdllAllocateNoiseMemory = dlsym(hLib, "AllocateNoiseMemory");
\t\tdllFreeNoiseMemory = dlsym(hLib, "FreeNoiseMemory");
\t\tdllInitializeNoise = dlsym(hLib, "InitializeNoise");
\t#endif"""

new_block = """\t#elif defined(__EMSCRIPTEN__)
\t\t/* WASM build: libp372 is statically linked — wire pointers directly. */
\t\tdllP372Version = P372Version;
\t\tdllP372CompileTime = P372CompileTime;
\t\tdllNoise = Noise;
\t\tdllAllocateNoiseMemory = AllocateNoiseMemory;
\t\tdllFreeNoiseMemory = FreeNoiseMemory;
\t\tdllInitializeNoise = InitializeNoise;
\t#elif __linux__ || __APPLE__
\t\tvoid * hLib;
\t\thLib = dlopen("libp372.so", RTLD_NOW);
\t\tif (!hLib) {
\t\t\tprintf("Couldn't load libp372.so, exiting.\\n");
\t\t\texit(1);
\t\t}
\t\tdllP372Version = dlsym(hLib, "P372Version");
\t\tdllP372CompileTime = dlsym(hLib, "P372CompileTime");
\t\tdllNoise = dlsym(hLib, "Noise");
\t\tdllAllocateNoiseMemory = dlsym(hLib, "AllocateNoiseMemory");
\t\tdllFreeNoiseMemory = dlsym(hLib, "FreeNoiseMemory");
\t\tdllInitializeNoise = dlsym(hLib, "InitializeNoise");
\t#endif"""

if old_block not in src:
    raise SystemExit("build.sh: expected dlopen block not found in P533.c — upstream changed?")
p533.write_text(src.replace(old_block, new_block, 1))
print("[build] Patched P533.c to use static linking on Emscripten.")

# ── Patch Noise.h: declare dll* pointers on Emscripten too ─────────────────
noise_h = Path("$SRC_DIR/P533/Src/P533/Noise.h")
nsrc = noise_h.read_text()
old_guard = "#elif defined(__linux__) || defined(__APPLE__)"
new_guard = "#elif defined(__linux__) || defined(__APPLE__) || defined(__EMSCRIPTEN__)"
if old_guard not in nsrc:
    raise SystemExit("build.sh: expected __linux__ guard not found in Noise.h — upstream changed?")
noise_h.write_text(nsrc.replace(old_guard, new_guard, 1))
print("[build] Patched Noise.h to declare dll* pointers on Emscripten.")
PYEOF
fi

P533_SRC="$SRC_DIR/P533/Src/P533"
P372_SRC="$SRC_DIR/P372/Src/P372"
ITU_SRC="$SRC_DIR/ITURHFProp/Src/ITURHFProp"

for d in "$P533_SRC" "$P372_SRC" "$ITU_SRC"; do
  if [[ ! -d "$d" ]]; then
    echo "error: expected source directory $d not found" >&2
    exit 1
  fi
done

# ── Collect translation units ─────────────────────────────────────────────────
# Order matches the upstream Makefiles — lets the build script stay in lockstep
# with the reference build if file lists change in a future release.

P533_SOURCES=(
  "$P533_SRC/Between7000kmand9000km.c"
  "$P533_SRC/ELayerScreeningFrequency.c"
  "$P533_SRC/Magfit.c"
  "$P533_SRC/MedianSkywaveFieldStrengthShort.c"
  "$P533_SRC/ReadIonParameters.c"
  "$P533_SRC/CalculateCPParameters.c"
  "$P533_SRC/Geometry.c"
  "$P533_SRC/MUFBasic.c"
  "$P533_SRC/P533.c"
  "$P533_SRC/MUFOperational.c"
  "$P533_SRC/ReadP1239.c"
  "$P533_SRC/CircuitReliability.c"
  "$P533_SRC/InitializePath.c"
  "$P533_SRC/MedianAvailableReceiverPower.c"
  "$P533_SRC/ReadType13.c"
  "$P533_SRC/InputDump.c"
  "$P533_SRC/MedianSkywaveFieldStrengthLong.c"
  "$P533_SRC/MUFVariability.c"
  "$P533_SRC/PathMemory.c"
  "$P533_SRC/ValidatePath.c"
)

P372_SOURCES=(
  "$P372_SRC/InitializeNoise.c"
  "$P372_SRC/Noise.c"
  "$P372_SRC/NoiseMemory.c"
)

ITU_SOURCES=(
  "$ITU_SRC/DumpPathData.c"
  "$ITU_SRC/ITURHFProp.c"
  "$ITU_SRC/ReadInputConfiguration.c"
  "$ITU_SRC/Report.c"
  "$ITU_SRC/ValidateITURHFP.c"
)

ALL_SOURCES=("${P533_SOURCES[@]}" "${P372_SOURCES[@]}" "${ITU_SOURCES[@]}")

# ── Compile to WASM ───────────────────────────────────────────────────────────
#
# -sMODULARIZE=1     emit a factory function, not a global Module
# -sEXPORT_ES6=1     ES-module output so Vite can tree-shake / lazy-load
# -sENVIRONMENT=web,worker
#                    drop the node-only shim paths — frontend use only
# -sALLOW_MEMORY_GROWTH=1
#                    coefficient tables push linear memory past the default 16MB
# -sEXIT_RUNTIME=1   call atexit handlers on main() return (ITURHFProp cleans up)
# -sINVOKE_RUN=0     don't auto-run main — let JS decide with callMain([...])
# -sFORCE_FILESYSTEM=1
#                    keep FS module available so we can mount coefficient files
#                    via MEMFS at runtime (see B3)
# -lnodefs.js        stub — we only need this to appease Emscripten if NODERAWFS
#                    were used. Kept off for browser build.
#
# Known upstream warnings we intentionally ignore for B1 (clean up in B2):
#   -Wno-unused-parameter -Wno-unused-variable
# The P.533 source is C89-ish with generous unused params in callback shapes.

INCLUDES=(-I"$P533_SRC" -I"$P372_SRC" -I"$ITU_SRC")

CFLAGS=(
  -O3
  -DNDEBUG
  # P533/P372 headers gate DLLEXPORT on _WIN32 / __linux__ / __APPLE__ only.
  # Emscripten doesn't define any of those, leaving DLLEXPORT as an unknown
  # type on every exported prototype. Override to empty — we statically link.
  -DDLLEXPORT=
  -std=c99
  -Wno-unused-parameter
  -Wno-unused-variable
  -Wno-unused-but-set-variable
  -Wno-incompatible-pointer-types
  -Wno-parentheses
)

LDFLAGS=(
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createP533Module
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sEXIT_RUNTIME=1
  -sINVOKE_RUN=0
  -sFORCE_FILESYSTEM=1
  # Runtime methods the JS wrapper needs to drive the WASM
  -sEXPORTED_RUNTIME_METHODS=callMain,FS,ccall,cwrap,UTF8ToString,stringToUTF8
  # ITURHFProp's main() parses argc/argv; expose it for callMain(...).
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free
  -sSTACK_SIZE=1048576
  -lm
)

echo "[build] Compiling ${#ALL_SOURCES[@]} translation units with emcc…"
emcc \
  "${CFLAGS[@]}" \
  "${INCLUDES[@]}" \
  "${ALL_SOURCES[@]}" \
  "${LDFLAGS[@]}" \
  -o "$DIST_DIR/p533.mjs"

# Emit a SHA256 alongside the artifact so the frontend can cache-bust the WASM
# binary deterministically once the build is hooked into usePropagation (B5).
if command -v shasum >/dev/null; then
  (cd "$DIST_DIR" && shasum -a 256 p533.mjs p533.wasm > p533.sha256)
elif command -v sha256sum >/dev/null; then
  (cd "$DIST_DIR" && sha256sum p533.mjs p533.wasm > p533.sha256)
fi

echo "[build] Done. Outputs:"
ls -lh "$DIST_DIR/"

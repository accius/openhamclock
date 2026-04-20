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

  # ── Patch upstream for static Emscripten linkage ────────────────────────────
  # The build defines -D__linux__ so the existing Linux/Apple branches in
  # Noise.h and ITURHFProp.h declare the dll* function-pointer globals that
  # the rest of the code expects. We just need to replace the runtime
  # dlopen()/dlsym() calls (which would fail on WASM) with direct assignment
  # to the statically-linked P372/P533 functions. We do this by inserting an
  # __EMSCRIPTEN__ branch ahead of each `#elif __linux__ || __APPLE__` block.
  # Because #elif chains match the first true condition, Emscripten hits our
  # branch first and skips the dlopen entirely.
  python3 - "$SRC_DIR" <<'PYEOF'
import sys
from pathlib import Path

src_dir = Path(sys.argv[1])

# Upstream C files have embedded Windows-1252 characters in comments
# (smart quotes, em dashes). Read/write as latin-1 which is byte-preserving -
# we only care about matching anchor strings, not interpreting the content.
ENC = "latin-1"


def read(path):
    return path.read_text(encoding=ENC)


def write(path, text):
    path.write_text(text, encoding=ENC)


def patch_file(path, edits):
    text = read(path)
    for anchor, replacement, desc in edits:
        if anchor not in text:
            sys.exit(f"build.sh: anchor not found in {path.name}: {desc}")
        text = text.replace(anchor, replacement, 1)
        print(f"[build] Patched {path.relative_to(src_dir)} - {desc}.")
    write(path, text)

# ── P533.c: insert __EMSCRIPTEN__ branch ahead of the libp372 dlopen block ────
p533_static = (
    "#elif defined(__EMSCRIPTEN__)\n"
    "\t\t/* WASM build: libp372 is statically linked - wire pointers directly. */\n"
    "\t\tdllP372Version = P372Version;\n"
    "\t\tdllP372CompileTime = P372CompileTime;\n"
    "\t\tdllNoise = Noise;\n"
    "\t\tdllAllocateNoiseMemory = AllocateNoiseMemory;\n"
    "\t\tdllFreeNoiseMemory = FreeNoiseMemory;\n"
    "\t\tdllInitializeNoise = InitializeNoise;\n"
    "\t"
)
patch_file(
    src_dir / "P533/Src/P533/P533.c",
    [
        (
            "#elif __linux__ || __APPLE__",
            p533_static + "#elif __linux__ || __APPLE__",
            "P533.c - static P372 linkage on Emscripten",
        ),
    ],
)

# ── ITURHFProp.c has TWO dlopen blocks: P533 and P372. Anchor on dlopen call
#    so we can disambiguate them even though both follow `#elif __linux__ …`.
ituhf_static_p533 = (
    "#elif defined(__EMSCRIPTEN__)\n"
    "\t/* P533CompileTime is defined in P533.c but not declared in any header. */\n"
    "\textern char const * P533CompileTime(void);\n"
    "\t/* WASM build: libp533 is statically linked - wire pointers directly. */\n"
    "\tdllP533Version = P533Version;\n"
    "\tdllP533CompileTime = P533CompileTime;\n"
    "\tdllP533 = P533;\n"
    "\tdllAllocatePathMemory = AllocatePathMemory;\n"
    "\tdllFreePathMemory = FreePathMemory;\n"
    "\tdllBearing = Bearing;\n"
    "\tdllReadType11Func = ReadType11;\n"
    "\tdllReadType13Func = ReadType13;\n"
    "\tdllReadType14Func = ReadType14;\n"
    "\tdllIsotropicPatternFunc = IsotropicPattern;\n"
    "\tdllReadIonParametersBinFunc = ReadIonParametersBin;\n"
    "\tdllReadIonParametersTxtFunc = ReadIonParametersTxt;\n"
    "\tdllReadP1239Func = ReadP1239;\n"
    "\t/* dllInputDump is only declared in the _WIN32 branch of ITURHFProp.h;\n"
    "\t * the Linux/Apple branch doesn't list it. Upstream code references it\n"
    "\t * only on Windows so the pointer can stay uninitialized here. */\n"
)
ituhf_static_p372 = (
    "#elif defined(__EMSCRIPTEN__)\n"
    "\t/* WASM build: libp372 is statically linked - wire pointers directly. */\n"
    "\tdllReadFamDud = ReadFamDud;\n"
)

ituhfp_c = src_dir / "ITURHFProp/Src/ITURHFProp/ITURHFProp.c"
text = read(ituhfp_c)
# Both dlopen blocks share the shape
#   #elif __linux__ || __APPLE__
#       void * hLib;
#       hLib = dlopen("libpXXX.so", RTLD_NOW);
# Anchor on that full 3-line header so each call site is unambiguous.
anchor_p533 = '#elif __linux__ || __APPLE__\n\tvoid * hLib;\n\thLib = dlopen("libp533.so"'
anchor_p372 = '#elif __linux__ || __APPLE__\n\tvoid * hLib;\n\thLib = dlopen("libp372.so"'
if anchor_p533 not in text:
    sys.exit("build.sh: libp533.so dlopen block not found in ITURHFProp.c")
if anchor_p372 not in text:
    sys.exit("build.sh: libp372.so dlopen block not found in ITURHFProp.c")
text = text.replace(anchor_p533, ituhf_static_p533 + anchor_p533, 1)
print("[build] Patched ITURHFProp.c - static P533 linkage on Emscripten.")
text = text.replace(anchor_p372, ituhf_static_p372 + anchor_p372, 1)
print("[build] Patched ITURHFProp.c - static P372 linkage on Emscripten.")

write(ituhfp_c, text)

# ── Mark duplicate helper functions as static ─────────────────────────────
# MedianSkywaveFieldStrengthLong.c and DumpPathData.c both define identical
# helpers degrees/minutes/seconds/hrs/mns. Upstream Linux gets away with this
# via `-z muldefs`; wasm-ld has no such flag, so force file-local linkage.
# These helpers are only called from within their defining .c files.
import re

HELPERS = ("degrees", "minutes", "seconds", "hrs", "mns")

def make_helpers_static(path):
    text = read(path)
    # Prepend static prototypes so any calls earlier in the file see the
    # static declaration before clang infers a non-static implicit one
    # (which then clashes with the later static definition).
    proto_block = (
        "/* Static prototypes injected for WASM build to resolve duplicate-symbol\n"
        " * collisions across translation units. These helpers are only used\n"
        " * file-locally in both upstream .c files that defined them. */\n"
        "static int degrees(double coord);\n"
        "static int minutes(double coord);\n"
        "static int seconds(double coord);\n"
        "static int hrs(double time);\n"
        "static int mns(double time);\n\n"
    )
    # Insert after the last #include line near the top of the file.
    lines = text.splitlines(keepends=True)
    last_include = 0
    for i, ln in enumerate(lines[:80]):
        if ln.startswith("#include"):
            last_include = i
    lines.insert(last_include + 1, proto_block)
    text = "".join(lines)
    # Now convert each definition to static.
    for name in HELPERS:
        pattern = re.compile(rf"^int {re.escape(name)}\(", re.MULTILINE)
        text, n = pattern.subn(f"static int {name}(", text)
        if n == 0:
            sys.exit(f"build.sh: couldn't find `int {name}(` at file scope in {path.name}")
    write(path, text)
    print(f"[build] Marked {', '.join(HELPERS)} as static in {path.relative_to(src_dir)}.")

# ITURHFProp.h leaks non-static prototypes for these helpers. Remove them
# so the file-local static versions don't clash. They're only called from
# DumpPathData.c which gets its own static prototypes prepended below.
ituhfp_h = src_dir / "ITURHFProp/Src/ITURHFProp/ITURHFProp.h"
htext = read(ituhfp_h)
removed = 0
for proto in (
    "int degrees(double coord);",
    "int minutes(double coord);",
    "int seconds(double coord);",
    "int hrs(double time);",
    "int mns(double time);",
):
    if proto in htext:
        htext = htext.replace(proto + "\n", "", 1)
        removed += 1
if removed == 0:
    print("[build] Warning: no helper prototypes removed from ITURHFProp.h")
write(ituhfp_h, htext)
print(f"[build] Removed {removed} helper prototypes from ITURHFProp.h.")

make_helpers_static(src_dir / "P533/Src/P533/MedianSkywaveFieldStrengthLong.c")
make_helpers_static(src_dir / "ITURHFProp/Src/ITURHFProp/DumpPathData.c")

# ── Extern-ify the dll* globals and provide a single definition file ──────
# Each dll* pointer is declared at file scope in Noise.h / ITURHFProp.h without
# `extern`, so every TU that includes the header emits a tentative definition
# and wasm-ld sees them as duplicates. Prefix each declaration with `extern`
# so the headers only declare (not define), then emit one new .c file that
# provides the canonical definitions - the `wasm_globals.c` file below is
# added to the source list.

def externify(path, guard_match):
    text = read(path)
    # Find the Linux/Apple branch start
    start = text.find(guard_match)
    if start == -1:
        sys.exit(f"build.sh: guard '{guard_match}' not found in {path.name}")
    # Find the matching #endif
    end = text.find("#endif", start)
    if end == -1:
        sys.exit(f"build.sh: #endif for guard not found in {path.name}")
    block = text[start:end]
    patched_block = re.sub(
        r"^(\s*)(void\s*\*|char\s*\*?\s*\(\s*\*|int\s*\(\s*\*|double\s*\(\s*\*|void\s*\(\s*\*)(\s*dll\w+|\s*hLib)",
        r"\1extern \2\3",
        block,
        flags=re.MULTILINE,
    )
    # Also catch the `iPathMemory dllXxx;` pattern used in _WIN32 branch -
    # but we're only touching the linux branch so skip that.
    text = text[:start] + patched_block + text[end:]
    write(path, text)


externify(
    src_dir / "P533/Src/P533/Noise.h",
    "#elif defined(__linux__) || defined(__APPLE__)",
)
externify(
    src_dir / "ITURHFProp/Src/ITURHFProp/ITURHFProp.h",
    "#elif __linux__ || __APPLE__",
)
print("[build] Extern-ified dll* declarations in Noise.h + ITURHFProp.h.")

# Emit canonical definitions in a fresh TU.
wasm_globals = src_dir / "wasm_globals.c"
wasm_globals.write_text(
    '/* Single-definition source for the dll* function-pointer globals\n'
    ' * that Noise.h and ITURHFProp.h declare as extern on Linux/WASM.\n'
    ' * Generated by wasm-build/build.sh; do not hand-edit. */\n'
    '#define __linux__ 1\n'  # force the Linux branch in headers
    '#include "P533.h"\n'
    '#include "ITURHFProp.h"\n'
    '\n'
    '/* Noise.h globals */\n'
    'void *hLib = (void *)0;\n'
    'char *(*dllP372Version)(void) = (void *)0;\n'
    'char *(*dllP372CompileTime)(void) = (void *)0;\n'
    'int (*dllNoise)(struct NoiseParams *, int, double, double, double) = (void *)0;\n'
    'int (*dllAllocateNoiseMemory)(struct NoiseParams *) = (void *)0;\n'
    'int (*dllFreeNoiseMemory)(struct NoiseParams *) = (void *)0;\n'
    'int (*dllReadFamDud)(struct NoiseParams *, const char *, int) = (void *)0;\n'
    'void (*dllInitializeNoise)(struct NoiseParams *) = (void *)0;\n'
    '\n'
    '/* ITURHFProp.h globals */\n'
    'char *(*dllP533Version)(void) = (void *)0;\n'
    'char *(*dllP533CompileTime)(void) = (void *)0;\n'
    'int (*dllP533)(struct PathData *) = (void *)0;\n'
    'int (*dllAllocatePathMemory)(struct PathData *) = (void *)0;\n'
    'int (*dllFreePathMemory)(struct PathData *) = (void *)0;\n'
    'int (*dllAllocateAntennaMemory)(struct Antenna *, int, int, int) = (void *)0;\n'
    'double (*dllBearing)(struct Location, struct Location, int) = (void *)0;\n'
    'int (*dllReadType11Func)(struct Antenna *, FILE *, int) = (void *)0;\n'
    'int (*dllReadType13Func)(struct Antenna *, FILE *, double, int) = (void *)0;\n'
    'int (*dllReadType14Func)(struct Antenna *, FILE *, int) = (void *)0;\n'
    'void (*dllIsotropicPatternFunc)(struct Antenna *, double, int) = (void *)0;\n'
    'int (*dllReadIonParametersTxtFunc)(struct PathData *, char[256], int) = (void *)0;\n'
    'int (*dllReadIonParametersBinFunc)(int, float ****, float ****, char[256], int) = (void *)0;\n'
    'int (*dllReadP1239Func)(struct PathData *, const char *) = (void *)0;\n',
    encoding=ENC,
)
print(f"[build] Emitted {wasm_globals.relative_to(src_dir)} with canonical definitions.")
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
# Order matches the upstream Makefiles - lets the build script stay in lockstep
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

WASM_GLOBALS="$SRC_DIR/wasm_globals.c"
ALL_SOURCES=("${P533_SOURCES[@]}" "${P372_SOURCES[@]}" "${ITU_SOURCES[@]}" "$WASM_GLOBALS")

# ── Compile to WASM ───────────────────────────────────────────────────────────
#
# -sMODULARIZE=1     emit a factory function, not a global Module
# -sEXPORT_ES6=1     ES-module output so Vite can tree-shake / lazy-load
# -sENVIRONMENT=web,worker
#                    drop the node-only shim paths - frontend use only
# -sALLOW_MEMORY_GROWTH=1
#                    coefficient tables push linear memory past the default 16MB
# -sEXIT_RUNTIME=1   call atexit handlers on main() return (ITURHFProp cleans up)
# -sINVOKE_RUN=0     don't auto-run main - let JS decide with callMain([...])
# -sFORCE_FILESYSTEM=1
#                    keep FS module available so we can mount coefficient files
#                    via MEMFS at runtime (see B3)
# -lnodefs.js        stub - we only need this to appease Emscripten if NODERAWFS
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
  # type on every exported prototype. Override to empty - we statically link.
  -DDLLEXPORT=
  # Pretend we're Linux so Noise.h/ITURHFProp.h declare the dll* function
  # pointers through their existing Linux/Apple branches. Emscripten already
  # provides a Linux-ish libc, so the headers themselves compile fine. We'll
  # then patch out the dlopen()/dlsym() runtime loading and replace it with
  # direct assignment - see the Python patch step above.
  -D__linux__
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

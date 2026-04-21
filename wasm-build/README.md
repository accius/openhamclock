# P.533 WASM build

Compiles ITU-R P.533-14 (the `libp533` + `libp372` + `ITURHFProp` trio from
[ITU-R-Study-Group-3/ITU-R-HF](https://github.com/ITU-R-Study-Group-3/ITU-R-HF))
to WebAssembly so the frontend can run HF propagation predictions client-side.

Binaries are **not committed**. CI builds them on demand and publishes the
artifact; contributors can also build locally.

## What's here

| File              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `build.sh`        | Downloads upstream source, compiles with `emcc`, emits `dist/`. |
| `smoke-test.mjs`  | Loads the built `p533.mjs` in Node to confirm it runs.          |
| `src/` (ignored)  | Upstream source tree, pinned to tag `v14.3`.                    |
| `dist/` (ignored) | Build output: `p533.mjs`, `p533.wasm`, `p533.sha256`.           |

## Building locally

Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
once:

```bash
git clone https://github.com/emscripten-core/emsdk ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk/emsdk_env.sh
```

Then from the repo root:

```bash
cd wasm-build
./build.sh
node smoke-test.mjs
```

Expected smoke-test output:

```
smoke-test: WASM module loaded
  HEAP8 size:       16.00 MB
  exported methods: callMain, FS, ccall, cwrap
smoke-test: ITURHFProp main() returned <non-zero, ok for B1>
smoke-test: OK
```

A non-zero exit is **expected** at this stage — ITURHFProp requires an input
file, and the coefficient data bundling happens in B3.

## CI

`.github/workflows/build-wasm.yml` runs the same `build.sh` on Ubuntu with
Emscripten 3.1.x and uploads `dist/` as a workflow artifact. The eventual
release workflow will publish those artifacts so the frontend can fetch them
from a known URL at runtime.

## Licensing

ITU-R-HF is distributed under the
[ITU permissive license](https://github.com/ITU-R-Study-Group-3/ITU-R-HF/blob/master/Docs/)
("may be used by implementers ... free from any copyright assertions, AS IS").
Redistribution of the compiled WASM with this project is permitted. Attribution
to ITU-R Study Group 3 and the original developers (Behm, Engelbrecht) will be
added alongside the shipped artifact in Phase B5.

## Roadmap

- **B1** (this): scaffolding, build compiles, smoke test runs. ← here
- **B2**: refactor file I/O from `fopen()` to in-memory buffers.
- **B3**: package coefficient data, IndexedDB cache, lazy per-month fetch.
- **B4**: JS wrapper API that mirrors `iturhfprop-service/`'s REST shape.
- **B5**: wire into `usePropagation` with WASM → REST → heuristic fallback.
- **B6**: parity validation against native reference.

# P.533 WASM build

Compiles ITU-R P.533-14 (the `libp533` + `libp372` + `ITURHFProp` trio from
[ITU-R-Study-Group-3/ITU-R-HF](https://github.com/ITU-R-Study-Group-3/ITU-R-HF))
to WebAssembly so the frontend can run HF propagation predictions client-side.

Binaries are **not committed**. CI builds them on demand and publishes the
artifact; contributors can also build locally.

## What's here

| File                    | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `build.sh`              | Downloads upstream source, compiles with `emcc`, emits `dist/`.                            |
| `smoke-test.mjs`        | Loads the built `p533.mjs` in Node to confirm the runtime initializes.                     |
| `smoke-test-e2e.mjs`    | Runs a real prediction by mounting coefficient files into MEMFS — needs `data-local/`.     |
| `src/` (ignored)        | Upstream source tree, pinned to tag `v14.3`.                                               |
| `dist/` (ignored)       | Build output: `p533.mjs`, `p533.wasm`, `p533.sha256`.                                      |
| `data-local/` (ignored) | A handful of upstream coefficient files staged for `smoke-test-e2e.mjs` — never committed. |

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

Expected output — the runtime loads and `FS` / `callMain` are exported.

### End-to-end smoke test (optional)

To prove the WASM runs an actual P.533 prediction, stage a few upstream
coefficient files into `data-local/` and run `smoke-test-e2e.mjs`. The script
header lists the exact files needed (~11 MB for one month). See
`smoke-test-e2e.mjs` for the scenario and expected physical behavior
(80m/40m midday CLOSED, 15m/20m OPEN at SSN 120).

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

- **B1**: scaffolding, build compiles, smoke test runs.
- **B2** (this): coefficient files served via MEMFS, end-to-end prediction works. ← here
- **B3**: package coefficient data for the browser, IndexedDB cache, lazy per-month fetch.
- **B4**: JS wrapper API that mirrors `iturhfprop-service/`'s REST shape.
- **B5**: wire into `usePropagation` with WASM → REST → heuristic fallback.
- **B6**: parity validation against native reference.

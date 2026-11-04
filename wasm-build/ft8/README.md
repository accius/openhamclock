# FT8 WASM build

Compiles [kgoba/ft8_lib](https://github.com/kgoba/ft8_lib) (MIT, pinned in
`build.sh`) plus a small wrapper to WebAssembly for the Decoder panel's FT8
tab. Binaries are **not committed**: `.github/workflows/build-wasm.yml`
(job `build-ft8`) builds, smoke-tests and publishes `ft8.{mjs,wasm,sha256}`
to the `wasm-latest` release, and `scripts/fetch-wasm.js` installs them into
`public/wasm/` at build time (skipping with a warning when the release has
no FT8 assets yet).

| File             | Purpose                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `ft8_wrapper.c`  | `ft8_decode(pcm, n, rate, fMin, fMax)` → malloc'd JSON `[{snr, dt, freq, text}]`; `ft8_free`, `ft8_reset`.      |
| `build.sh`       | Fetches ft8_lib, compiles with `emcc` → `../dist/ft8.mjs` + `.wasm` + `.sha256`. `--native` builds with `cc`.   |
| `native_test.c`  | Native driver: decode WAV files with the wrapper, one JSON line per file.                                       |
| `compare.mjs`    | Scores decodes against ft8_lib's WSJT-X reference `.txt` files (recall, SNR/DT/frequency error).                |
| `smoke-test.mjs` | CI: runs the built module through the app's own glue (`src/utils/ft8Wasm.js`) on the test WAVs and scores them. |

## The wrapper

- One call decodes one 15 s slot (12 kHz expected; other rates work). Every
  allocation it makes — the ft8_lib monitor, waterfall and FFT work areas — is
  freed before it returns; only the returned JSON (free it with `ft8_free`) and
  a fixed 256-entry callsign hash table (resolves `<hashed>` calls in later
  slots; `ft8_reset` clears it) outlive the call.
- **SNR**: ft8_lib reports only a sync score, so the wrapper re-encodes each
  decoded message to its 79 tones, measures the power in those waterfall bins
  against the slot's median bin power, and maps that to WSJT-X's 2500 Hz scale
  with a least-squares fit (`SNR_SLOPE`, `SNR_ICPT_DB`).
- **DT** is relative to the nominal start 0.5 s into the slot, corrected by
  the 0.16 s systematic offset measured against WSJT-X.

## Checking it without Emscripten

```bash
cd wasm-build/ft8
./build.sh --native     # cc + ft8_lib's 31 test WAVs → compare.mjs
```

Result at the pinned commit with the shipped settings (2026-10): 275 of the
362 messages WSJT-X decoded from the same recordings (76.0 %), 8 decodes
WSJT-X did not list; SNR within ±3 dB of WSJT-X for 65 % (median error 3.0 dB,
mean bias 0.25 dB); DT within 0.1 s for 91 %; frequency within 3 Hz for 98 %.
AddressSanitizer/UBSan clean over all WAVs, and macOS `leaks` finds 0 bytes
leaked after 40 decode calls.

### Choosing the settings

Native sweep over the same 31 WAVs (time per 15 s slot on an M-series Mac;
the WASM build in node takes about 2.3× that):

| min score | candidates | LDPC iter. | freq / time OSR | passes | recall     | ms/slot |
| --------- | ---------- | ---------- | --------------- | ------ | ---------- | ------- |
| 10        | 140        | 25         | 2 / 2           | 1      | 71.5 %     | 11      |
| 5         | 500        | 50         | 2 / 2           | 1      | 71.5 %     | 68      |
| 10        | 300        | 25         | 4 / 2           | 1      | 58.8 %     | 17      |
| 10        | 300        | 25         | 2 / 4           | 1      | 74.0 %     | 19      |
| 10        | 300        | 25         | 2 / 8           | 1      | 74.0 %     | 26      |
| **10**    | **300**    | **25**     | **2 / 4**       | **2**  | **76.0 %** | **38**  |
| 10        | 300        | 25         | 2 / 4           | 3      | 76.0 %     | 42      |

More candidates, a lower sync threshold or more LDPC iterations find nothing
new (the misses are not candidates that ran out of iterations); 4× time
oversampling and a second pass over the waterfall with the first pass's
signals masked (`mask_signal`) do. Shipped: the bold row — 45 ms per slot in
WASM on the Mac, comfortably inside the ~300 ms budget on slower machines.

## Building the WASM locally

```bash
source ~/emsdk/emsdk_env.sh   # Emscripten 3.1.64, as in CI
cd wasm-build/ft8
./build.sh && node smoke-test.mjs
```

`smoke-test.mjs` fails (and CI does not publish) if recall drops below 72 % or
if WASM memory grows between two identical passes over the test set. Built
this way with Emscripten 3.1.64 (2026-10): `ft8.wasm` 59 KB, `ft8.mjs` 12 KB;
the WASM decodes exactly what the native build does (same 275/362), memory
stays at its initial 16 MB across 93 decodes, and a slot decodes in 20–50 ms
in Chromium.

## Licensing

ft8_lib is MIT-licensed (© 2018 Kārlis Goba); KISS FFT (bundled with it) is
BSD-3-Clause. Both are compatible with OpenHamClock's MIT licence.

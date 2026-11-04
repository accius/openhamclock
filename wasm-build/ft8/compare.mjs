#!/usr/bin/env node
/**
 * compare.mjs — score ft8_wrapper output against WSJT-X reference decodes.
 *
 *   node compare.mjs results.jsonl
 *
 * results.jsonl: one line per WAV from native_test (or the WASM smoke test):
 *   {"file":".../191111_110130.wav","decodes":[{snr,dt,freq,text}, …]}
 * Each WAV with a sibling .txt (ft8_lib's test set: WSJT-X output lines
 * "HHMMSS  SNR  DT  FREQ ~  TEXT") is scored: how many reference messages we
 * decoded, how many of ours are not in the reference, and the SNR / DT /
 * frequency error on the matches. Exits 1 when recall drops below MIN_RECALL.
 */
import fs from 'node:fs';

const MIN_RECALL = Number(process.env.MIN_RECALL || 0.6);
const file = process.argv[2];
if (!file) {
  console.error('usage: node compare.mjs results.jsonl');
  process.exit(2);
}

const norm = (t) =>
  String(t || '')
    .toUpperCase()
    .replace(/\s{2,}.*$/, '') // WSJT-X appends "   Country" after two+ spaces
    .replace(/[<>]/g, '')
    .trim();

let refTotal = 0;
let matched = 0;
let ours = 0;
let extra = 0;
const snrErr = [];
const dtErr = [];
const fErr = [];
const perFile = [];

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const txt = r.file.replace(/\.wav$/, '.txt');
  if (!fs.existsSync(txt)) continue;
  const ref = fs
    .readFileSync(txt, 'utf8')
    .split('\n')
    .map((l) => l.match(/^\s*\d{6}\s+(-?\d+)\s+(-?[\d.]+)\s+(\d+)\s+~\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ snr: +m[1], dt: +m[2], freq: +m[3], text: norm(m[4]) }));
  const got = (r.decodes || []).map((d) => ({ ...d, text: norm(d.text) }));
  let fileMatched = 0;
  const used = new Set();
  for (const want of ref) {
    // Same text, nearest frequency (a message can appear twice in one slot)
    let hit = -1;
    for (let i = 0; i < got.length; i++) {
      if (used.has(i) || got[i].text !== want.text) continue;
      if (hit < 0 || Math.abs(got[i].freq - want.freq) < Math.abs(got[hit].freq - want.freq)) hit = i;
    }
    if (hit < 0) continue;
    used.add(hit);
    fileMatched++;
    fErr.push(got[hit].freq - want.freq);
    // Timing/level errors only for the same transmission (within 10 Hz)
    if (Math.abs(got[hit].freq - want.freq) <= 10) {
      snrErr.push(got[hit].snr - want.snr);
      dtErr.push(got[hit].dt - want.dt);
    }
  }
  refTotal += ref.length;
  matched += fileMatched;
  ours += got.length;
  extra += got.length - used.size;
  perFile.push(`${r.file.split('/').pop()}: ${fileMatched}/${ref.length} (+${got.length - used.size} not in ref)`);
}

const stats = (a) => {
  if (!a.length) return 'n/a';
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  const abs = a.map(Math.abs).sort((x, y) => x - y);
  const mae = abs.reduce((x, y) => x + y, 0) / a.length;
  const within = (lim) => ((abs.filter((x) => x <= lim).length / a.length) * 100).toFixed(0);
  return `n ${a.length}, mean ${mean.toFixed(2)}, sd ${sd.toFixed(2)}, mae ${mae.toFixed(2)}, median |err| ${abs[abs.length >> 1].toFixed(2)}, ≤3: ${within(3)} %, ≤0.1: ${within(0.1)} %`;
};

console.log(perFile.join('\n'));
const recall = refTotal ? matched / refTotal : 0;
console.log(
  `\nreference messages decoded: ${matched}/${refTotal} (${(recall * 100).toFixed(1)} %); ours ${ours}, not in reference ${extra}`,
);
console.log(`SNR error (ours − WSJT-X, dB): ${stats(snrErr)}`);
console.log(`DT error (s): ${stats(dtErr)}`);
console.log(`freq error (Hz): ${stats(fErr)}`);
if (recall < MIN_RECALL) {
  console.error(`recall ${recall.toFixed(3)} below MIN_RECALL ${MIN_RECALL}`);
  process.exit(1);
}

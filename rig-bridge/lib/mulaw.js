'use strict';
/**
 * mulaw.js — G.711 µ-law companding, 16-bit PCM ⇄ 8-bit.
 *
 * Halves the KiwiSDR audio stream for the Cloud Relay (12 kHz × 16 bit =
 * 24 kB/s → 12 kB/s) at telephone quality, which is plenty for CW and FT8:
 * µ-law keeps ~38 dB SNR across a 70 dB range, and the decoders work on
 * the signal-to-noise of the receiver, not of the codec. The browser side
 * lives in src/utils/pcmStream.js (createMulawDecoder).
 */

const BIAS = 0x84;
const CLIP = 32635;

/** One 16-bit sample → one µ-law byte (ITU-T G.711). */
function encodeSample(sample) {
  let s = sample | 0;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One µ-law byte → one 16-bit sample. */
function decodeSample(byte) {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -s : s;
}

/**
 * Big-endian signed 16-bit PCM Buffer (the Kiwi's SND payload) → µ-law Buffer.
 * An odd trailing byte is ignored (Kiwi frames are always whole samples).
 */
function encodeS16be(buf) {
  const n = buf.length >> 1;
  const out = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) out[i] = encodeSample(buf.readInt16BE(i * 2));
  return out;
}

module.exports = { encodeSample, decodeSample, encodeS16be };

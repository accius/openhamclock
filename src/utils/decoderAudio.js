/**
 * decoderAudio.js — the Decoder panel's audio graph.
 *
 *   source ─► input gain ─┬─► AnalyserNode (waterfall/spectrum)  ─┐
 *                         ├─► AudioWorkletNode 'cw-decoder'       ─┼─► silent sink ─► destination
 *                         │   (or 'pcm-tap' → FT8 worker in FT8 mode)
 *                         └─► monitor gain (0/1) ─────────────────────► destination
 *
 * Sources:
 *   'mic'  — getUserMedia on a chosen input device (sound card / line in
 *            from the receiver), with echo cancellation, noise suppression
 *            and AGC switched OFF: they would mangle CW keying.
 *   'kiwi' — a KiwiSDR via Rig Bridge: directly (GET <bridge>/api/kiwi-audio/stream,
 *            s16be PCM) or through the Cloud Relay (GET /api/rig-bridge/relay/audio,
 *            µ-law); decoded and scheduled as AudioBuffers.
 *
 * The silent sink keeps the worklet and analyser pulled by the audio
 * rendering thread without making them audible.
 */
import workletUrl from '../worklets/cwDecoderWorklet.js?worker&url';
import { createAudioDecoder, PlayheadScheduler } from './pcmStream.js';
import { kiwiStreamRequest } from './kiwiAudioClient.js';
import { relayReadHeaders, sendRelayCommand } from './relaySign.js';

/** Audio input devices (labels are blank until the user has granted permission once). */
export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

export function audioDecoderSupported() {
  return (
    typeof window !== 'undefined' &&
    !!(window.AudioContext || window.webkitAudioContext) &&
    typeof window.AudioWorkletNode === 'function'
  );
}

export class DecoderAudioEngine {
  /**
   * @param {{ onUpdate?: (msg) => void, onError?: (err: Error) => void, onStatus?: (s: string) => void,
   *           onPcm?: (samples: Float32Array, sampleRate: number, endTimeMs: number) => void }} handlers
   */
  constructor({ onUpdate, onError, onStatus, onPcm } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onPcm = onPcm || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ctx = null;
    this.running = false;
  }

  /**
   * @param {{ source: 'mic'|'kiwi', mode?: 'cw'|'ft8', deviceId?: string, tone?: number, bandwidth?: 'auto'|number,
   *           kiwi?: { bridgeUrl?: string, token?: string, relaySession?: string, freqKhz: number, mode?: string } }} opts
   */
  async start(opts) {
    await this.stop();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.running = true;
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (this.ctx !== ctx) return; // stopped while loading

      this.input = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;
      this.analyser.minDecibels = -120;
      this.analyser.maxDecibels = -20;
      const nodeOpts = {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      };
      if (opts.mode === 'ft8') {
        // FT8: raw audio goes to the FT8 worker; map the audio clock to UTC
        // using the context clock at the moment each batch arrives.
        this.node = new AudioWorkletNode(ctx, 'pcm-tap', nodeOpts);
        this.node.port.onmessage = (e) => {
          const { samples, endTime } = e.data || {};
          if (!samples || this.ctx !== ctx) return;
          // KiwiSDR audio is played into the graph `kiwiLeadMs` after it arrived
          // (jitter buffer): date the samples by their arrival instead. The
          // rest of the path (Kiwi → bridge → browser) is corrected from the
          // decodes themselves (ft8Dsp DtCalibrator).
          const endTimeMs = Date.now() - (ctx.currentTime - endTime) * 1000 - (this.kiwiLeadMs || 0);
          this.onPcm(samples, ctx.sampleRate, endTimeMs);
        };
      } else {
        this.node = new AudioWorkletNode(ctx, 'cw-decoder', {
          ...nodeOpts,
          processorOptions: {
            tone: opts.tone || 600,
            bandwidth: opts.bandwidth || 'auto',
            squelch: opts.squelch || 'normal',
          },
        });
        this.node.port.onmessage = (e) => this.onUpdate(e.data);
      }
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.monitor = ctx.createGain();
      this.monitor.gain.value = 0;

      this.input.connect(this.analyser);
      this.input.connect(this.node);
      this.input.connect(this.monitor);
      this.analyser.connect(this.sink);
      this.node.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.monitor.connect(ctx.destination);

      if (opts.source === 'kiwi') await this.startKiwi(opts.kiwi || {});
      else await this.startMic(opts.deviceId);
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async startMic(deviceId) {
    const constraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!this.ctx) {
      this.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.input);
    this.onStatus('listening');
  }

  async startKiwi({ bridgeUrl, token, relaySession, freqKhz, mode = 'cw' }) {
    const request = kiwiStreamRequest({ bridgeUrl, token, relaySession, freqKhz, mode });
    if (!request) throw new Error('Rig Bridge is not configured');
    const abort = new AbortController();
    this.abort = abort;
    this.onStatus('connecting');
    let headers = request.headers;
    if (request.via === 'relay') {
      // Rig Bridge only starts a receiver for a signed command from a paired
      // browser; the audio itself needs the session's read token.
      const sent = await sendRelayCommand(relaySession, request.startCommand.type, request.startCommand.payload);
      if (!sent.ok) throw new Error(sent.error || 'Cloud Relay refused the KiwiSDR start command');
      if (!sent.signed) {
        throw new Error(
          'This browser is not paired with Rig Bridge — re-run Connect Cloud Relay in Settings → Rig Bridge',
        );
      }
      headers = { ...headers, ...(await relayReadHeaders(relaySession)) };
    }
    const res = await fetch(request.url, {
      headers,
      signal: abort.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {
        // not JSON
      }
      throw new Error(msg);
    }
    const rate = parseFloat(res.headers.get('X-Sample-Rate')) || 12000;
    this.kiwiRate = rate;
    // The bridge tunes CW so the station on the entered frequency is heard
    // at this pitch; the panel sets the decoder tone from it.
    this.kiwiCwPitch = Number(res.headers.get('X-CW-Pitch')) || null;
    this.kiwiVia = request.via;
    this.onStatus('listening');
    const reader = res.body.getReader();
    const decode = createAudioDecoder(res.headers.get('X-Audio-Format'));
    const sched = new PlayheadScheduler({ leadSec: 0.3, maxLagSec: 1.5 });
    const ctx = this.ctx;
    // Pump in the background; errors after start are reported, not thrown.
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.ctx !== ctx) break;
          const samples = decode(value);
          if (!samples.length) continue;
          const buf = ctx.createBuffer(1, samples.length, rate);
          buf.copyToChannel(samples, 0);
          const at = sched.next(ctx.currentTime, buf.duration);
          if (at !== null) {
            // smoothed jitter-buffer delay between arrival and playback into the graph
            const lead = (at - ctx.currentTime) * 1000;
            this.kiwiLeadMs = this.kiwiLeadMs == null ? lead : this.kiwiLeadMs + (lead - this.kiwiLeadMs) * 0.05;
          }
          if (at === null) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.input);
          src.start(at);
        }
        if (this.ctx === ctx) {
          this.onStatus('ended');
          this.onError(new Error('KiwiSDR stream ended'));
        }
      } catch (err) {
        if (err?.name !== 'AbortError' && this.ctx === ctx) this.onError(err);
      }
    })();
  }

  post(msg) {
    this.node?.port.postMessage(msg);
  }

  setTone(hz) {
    this.post({ type: 'tone', hz });
  }

  setBandwidth(value) {
    this.post({ type: 'bandwidth', value });
  }

  /** 'low' | 'normal' | 'high' */
  setSquelch(level) {
    this.post({ type: 'squelch', level });
  }

  findTone(seconds = 3) {
    this.post({ type: 'find', seconds });
  }

  resetDecoder() {
    this.post({ type: 'reset' });
  }

  setMonitor(on, volume = 0.8) {
    if (this.monitor && this.ctx) this.monitor.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.02);
  }

  get sampleRate() {
    return this.ctx?.sampleRate || 0;
  }

  async stop() {
    this.running = false;
    const ctx = this.ctx;
    this.ctx = null;
    try {
      this.abort?.abort();
    } catch {
      // already aborted
    }
    this.abort = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.node) this.node.port.onmessage = null;
    this.source = this.node = this.analyser = this.input = this.sink = this.monitor = null;
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close();
      } catch {
        // already closing
      }
    }
  }
}

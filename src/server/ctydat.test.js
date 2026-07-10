import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry, parseCtyDat } from './ctydat.js';

// Minimal valid cty.dat fragment matching the AD1C format:
//   header line at column 0, alias prefixes on indented lines, block ends with ';'
const CTY_SAMPLE = [
  'United States:  05:  08:  NA:  43.00:  100.00:  -5.0:  K:    ',
  '    K,KA,KB,KC,KD,KE,N,W,AA,AB,AC,KH6,NH6,=K1AAA;',
].join('\n');

function makeOkResponse(text) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
  });
}

function makeFailResponse() {
  return Promise.reject(new Error('request failed, reason: '));
}

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds on the first attempt without retrying', async () => {
    const fetchImpl = vi.fn(() => makeOkResponse(CTY_SAMPLE));
    const ok = await fetchWithRetry({
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(makeFailResponse)
      .mockImplementationOnce(makeFailResponse)
      .mockImplementationOnce(() => makeOkResponse(CTY_SAMPLE));

    const ok = await fetchWithRetry({
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl,
    });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts and returns false', async () => {
    const fetchImpl = vi.fn(makeFailResponse);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ok = await fetchWithRetry({
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl,
    });

    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Should log a retry warning between attempts (not after the last one)
    const retryWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('Retrying'));
    expect(retryWarnings).toHaveLength(2);
  });

  it('parses the fetched cty.dat into entities and prefixes', async () => {
    const fetchImpl = vi.fn(() => makeOkResponse(CTY_SAMPLE));
    await fetchWithRetry({
      maxAttempts: 1,
      baseDelayMs: 1,
      fetchImpl,
    });
    // parseCtyDat is exported — verify the sample round-trips
    const parsed = parseCtyDat(CTY_SAMPLE);
    expect(parsed.entities.length).toBe(1);
    expect(parsed.entities[0].entity).toBe('United States');
    expect(parsed.entities[0].dxcc).toBe('K');
    expect(Object.keys(parsed.prefixes).length).toBeGreaterThan(0);
    // Exact callsign match (prefixed with =)
    expect(parsed.exact['K1AAA']).toBeDefined();
    expect(parsed.exact['K1AAA'].entity).toBe('United States');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { __internal, clearCache, getDecileFactors, getMonthFiles } from './dataLoader.js';

// jsdom doesn't ship indexedDB — the loader's IDB calls silently no-op
// through their try/catch guards, and every request falls through to the
// mocked fetch path. That's the behaviour we want for unit tests anyway.

function gz(bytes) {
  return new Uint8Array(gzipSync(Buffer.from(bytes)));
}

function makeManifest(entries) {
  return JSON.stringify({
    version: 'v14.3',
    generated_at: '2026-04-24T00:00:00Z',
    files: entries,
  });
}

function stubFetch(handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      const res = await handler(url);
      if (!res) return new Response('not found', { status: 404 });
      return res;
    }),
  );
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await clearCache().catch(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('padMonth', () => {
  it('zero-pads single-digit months', () => {
    expect(__internal.padMonth(1)).toBe('01');
    expect(__internal.padMonth(9)).toBe('09');
  });

  it('passes two-digit months through', () => {
    expect(__internal.padMonth(10)).toBe('10');
    expect(__internal.padMonth(12)).toBe('12');
  });

  it('rejects out-of-range months', () => {
    expect(() => __internal.padMonth(0)).toThrow(/invalid month/);
    expect(() => __internal.padMonth(13)).toThrow(/invalid month/);
    expect(() => __internal.padMonth(1.5)).toThrow(/invalid month/);
    expect(() => __internal.padMonth('oops')).toThrow(/invalid month/);
  });
});

describe('assetsForMonth', () => {
  it('maps month to gzipped ionos + COEFF with canonical names', () => {
    expect(__internal.assetsForMonth(3)).toEqual([
      { asset: 'ionos03.bin.gz', canonical: 'ionos03.bin' },
      { asset: 'COEFF03W.txt.gz', canonical: 'COEFF03W.txt' },
    ]);
    expect(__internal.assetsForMonth(12)).toEqual([
      { asset: 'ionos12.bin.gz', canonical: 'ionos12.bin' },
      { asset: 'COEFF12W.txt.gz', canonical: 'COEFF12W.txt' },
    ]);
  });
});

describe('gunzip', () => {
  it('round-trips bytes through gzip/DecompressionStream', async () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
    const out = await __internal.gunzip(gz(original));
    expect(Array.from(out)).toEqual(Array.from(original));
  });
});

describe('sha256Hex', () => {
  it('produces the canonical NIST test-vector hash', async () => {
    const empty = new Uint8Array(0);
    expect(await __internal.sha256Hex(empty)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const abc = new TextEncoder().encode('abc');
    expect(await __internal.sha256Hex(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('getMonthFiles', () => {
  it('fetches both ionos + COEFF for the requested month', async () => {
    const ionos = new TextEncoder().encode('fake-ionos-payload');
    const coeff = new TextEncoder().encode('fake-coeff-payload');
    stubFetch(async (url) => {
      if (url.includes('/manifest.json')) {
        return new Response(makeManifest([]));
      }
      if (url.includes('/ionos01.bin.gz')) return new Response(gz(ionos));
      if (url.includes('/COEFF01W.txt.gz')) return new Response(gz(coeff));
      return null;
    });

    const files = await getMonthFiles(1);
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('ionos01.bin');
    expect(new TextDecoder().decode(files[0].bytes)).toBe('fake-ionos-payload');
    expect(files[1].name).toBe('COEFF01W.txt');
    expect(new TextDecoder().decode(files[1].bytes)).toBe('fake-coeff-payload');
  });

  it('verifies sha256 against manifest and rejects tampered bytes', async () => {
    const real = new TextEncoder().encode('authentic');
    const tampered = new TextEncoder().encode('tampered');
    const realSha = await __internal.sha256Hex(gz(real));

    stubFetch(async (url) => {
      if (url.includes('/manifest.json')) {
        return new Response(
          makeManifest([
            { name: 'ionos02.bin.gz', size: 0, sha256: realSha },
            { name: 'COEFF02W.txt.gz', size: 0, sha256: realSha },
          ]),
        );
      }
      if (url.includes('/ionos02.bin.gz')) return new Response(gz(tampered));
      if (url.includes('/COEFF02W.txt.gz')) return new Response(gz(real));
      return null;
    });

    await expect(getMonthFiles(2)).rejects.toThrow(/sha256 mismatch/);
  });

  it('propagates network failures', async () => {
    stubFetch(async (url) => {
      if (url.includes('/manifest.json')) return new Response(makeManifest([]));
      return null; // every month asset 404s
    });
    await expect(getMonthFiles(5)).rejects.toThrow(/fetch.*failed: 404/);
  });

  it('rejects invalid month inputs', async () => {
    await expect(getMonthFiles(0)).rejects.toThrow(/invalid month/);
    await expect(getMonthFiles(13)).rejects.toThrow(/invalid month/);
  });
});

describe('getDecileFactors', () => {
  it('returns bytes keyed by the canonical space-separated WASM filename', async () => {
    const payload = new TextEncoder().encode('decile-factors');
    stubFetch(async (url) => {
      if (url.includes('/manifest.json')) return new Response(makeManifest([]));
      if (url.includes('/P1239-3-Decile-Factors.txt.gz')) return new Response(gz(payload));
      return null;
    });

    const file = await getDecileFactors();
    expect(file.name).toBe('P1239-3 Decile Factors.txt'); // space, not hyphen
    expect(new TextDecoder().decode(file.bytes)).toBe('decile-factors');
  });
});

describe('concurrent callers', () => {
  it('dedupes in-flight requests so two callers share one fetch', async () => {
    let ionosHits = 0;
    let coeffHits = 0;
    const payload = new TextEncoder().encode('x');

    stubFetch(async (url) => {
      if (url.includes('/manifest.json')) return new Response(makeManifest([]));
      if (url.includes('/ionos06.bin.gz')) {
        ionosHits++;
        return new Response(gz(payload));
      }
      if (url.includes('/COEFF06W.txt.gz')) {
        coeffHits++;
        return new Response(gz(payload));
      }
      return null;
    });

    const [a, b] = await Promise.all([getMonthFiles(6), getMonthFiles(6)]);
    expect(a[0].bytes).toEqual(b[0].bytes);
    expect(ionosHits).toBe(1);
    expect(coeffHits).toBe(1);
  });
});

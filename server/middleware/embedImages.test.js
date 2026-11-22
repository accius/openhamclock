/**
 * Public image routes must be embeddable from another origin. Helmet's
 * default CORP is same-origin, which makes a cross-origin <img> show alt
 * text even though curl gets 200. These routes override that one header.
 * Everything else keeps Helmet's policy.
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import { allowEmbeddableImages, isEmbeddableImagePath } from './embedImages.js';

describe('isEmbeddableImagePath', () => {
  it('matches the public image routes and nothing private', () => {
    expect(isEmbeddableImagePath('/api/badge/solar.png')).toBe(true);
    expect(isEmbeddableImagePath('/api/badge/sun.png')).toBe(true);
    expect(isEmbeddableImagePath('/api/badge/moon.png')).toBe(true);
    expect(isEmbeddableImagePath('/api/badge/solar.png?theme=red')).toBe(true);
    expect(isEmbeddableImagePath('/api/badge/themes')).toBe(true);
    expect(isEmbeddableImagePath('/api/solar/image/0193')).toBe(true);
    expect(isEmbeddableImagePath('/api/solar/image/HMIIC')).toBe(true);
    expect(isEmbeddableImagePath('/api/moon-image')).toBe(true);

    expect(isEmbeddableImagePath('/api/solar-indices')).toBe(false);
    expect(isEmbeddableImagePath('/api/solar/image')).toBe(false);
    expect(isEmbeddableImagePath('/api/moon-data')).toBe(false);
    expect(isEmbeddableImagePath('/api/control/capture.png')).toBe(false);
    expect(isEmbeddableImagePath('/api/wefax/chart/PYAA12')).toBe(false);
    expect(isEmbeddableImagePath('/api/health')).toBe(false);
  });
});

describe('CORP through Helmet', () => {
  let server;

  afterEach(
    () =>
      new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      }),
  );

  function start() {
    const app = express();
    // Default Helmet, including its content security policy. The assertions
    // below only care about CORP, which stays same-origin until the embed
    // middleware overrides it.
    app.use(helmet());
    app.use(allowEmbeddableImages);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    app.get('/api/solar/image/:type', (req, res) => {
      res.set('Content-Type', 'image/jpeg');
      res.send(jpeg);
    });
    app.get('/api/moon-image', (req, res) => {
      res.set('Content-Type', 'image/jpeg');
      res.send(jpeg);
    });
    app.get('/api/badge/solar.png', (req, res) => {
      res.set('Content-Type', 'image/png');
      res.send(jpeg);
    });
    app.get('/api/badge/sun.png', (req, res) => {
      res.set('Content-Type', 'image/png');
      res.send(jpeg);
    });
    app.get('/api/badge/moon.png', (req, res) => {
      res.set('Content-Type', 'image/png');
      res.send(jpeg);
    });
    app.get('/api/badge/themes', (req, res) => res.json({ ok: true }));
    app.get('/api/solar-indices', (req, res) => res.json({ sfi: 1 }));
    app.get('/api/control/capture.png', (req, res) => {
      res.set('Content-Type', 'image/png');
      res.send(jpeg);
    });
    return new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
  }

  async function probe(port, path) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    await res.arrayBuffer();
    return {
      status: res.status,
      corp: res.headers.get('cross-origin-resource-policy'),
      coep: res.headers.get('cross-origin-embedder-policy'),
      coop: res.headers.get('cross-origin-opener-policy'),
      xfo: res.headers.get('x-frame-options'),
      referrer: res.headers.get('referrer-policy'),
    };
  }

  it('sends cross-origin CORP on embeddable images and keeps same-origin everywhere else', async () => {
    const port = await start();
    for (const path of [
      '/api/solar/image/0193',
      '/api/moon-image',
      '/api/badge/solar.png',
      '/api/badge/sun.png',
      '/api/badge/moon.png',
      '/api/badge/themes',
    ]) {
      const headers = await probe(port, path);
      expect(headers.status, path).toBe(200);
      expect(headers.corp, path).toBe('cross-origin');
      expect(headers.coep, path).toBeNull();
    }

    for (const path of ['/api/solar-indices', '/api/control/capture.png']) {
      const headers = await probe(port, path);
      expect(headers.corp, path).toBe('same-origin');
      expect(headers.xfo, path).toBe('SAMEORIGIN');
      expect(headers.coep, path).toBeNull();
      expect(headers.referrer, path).toBe('no-referrer');
    }
  });
});

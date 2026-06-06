#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const REPO = process.env.WASM_REPO || 'accius/openhamclock';
const TAG = process.env.WASM_RELEASE_TAG || 'wasm-latest';
const DEST_DIR = path.join('public', 'wasm');
const BASE_URL = `https://github.com/${REPO}/releases/download/${TAG}`;

function warn(message) {
  console.error(`⚠  fetch-wasm: ${message} — skipping (runtime will use REST fallback)`);
  process.exit(0);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const location = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, url).toString();
        return resolve(download(location, dest));
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }

      const fileStream = fs.createWriteStream(dest);
      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(resolve));
      fileStream.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyChecksum(destDir) {
  const checksumFile = path.join(destDir, 'p533.sha256');
  const wasmFile = path.join(destDir, 'p533.wasm');

  if (!fs.existsSync(checksumFile) || !fs.existsSync(wasmFile)) {
    return;
  }

  const raw = fs.readFileSync(checksumFile, 'utf8').trim();
  const expected = raw.split(/\s+/)[0];
  if (!expected) return;

  const actual = await sha256File(wasmFile);
  if (expected !== actual) {
    throw new Error('sha256 mismatch on downloaded WASM');
  }
}

(async () => {
  try {
    if (!fs.existsSync(DEST_DIR)) {
      fs.mkdirSync(DEST_DIR, { recursive: true });
    }

    console.log(`→ fetch-wasm: downloading from ${BASE_URL}...`);
    const files = ['p533.mjs', 'p533.wasm', 'p533.sha256'];

    for (const filename of files) {
      const url = `${BASE_URL}/${filename}`;
      const dest = path.join(DEST_DIR, filename);
      await download(url, dest);
    }

    await verifyChecksum(DEST_DIR);
    console.log(`✓ fetch-wasm: installed to ${DEST_DIR}/`);

    const installed = fs.readdirSync(DEST_DIR).filter((name) => /p533\.(mjs|wasm)$/.test(name));
    if (installed.length > 0) {
      console.log(installed.map((name) => `- ${name}`).join('\n'));
    }
  } catch (error) {
    warn(error.message);
  }
})();

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
      response.on('error', reject);
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
  if (!fs.existsSync(checksumFile)) return;

  const lines = fs
    .readFileSync(checksumFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [expected, filename] = line.split(/\s+/);
    if (!expected || !filename) continue;
    const filePath = path.join(destDir, filename);
    if (!fs.existsSync(filePath)) continue;
    const actual = await sha256File(filePath);
    if (expected !== actual) {
      throw new Error(`sha256 mismatch on ${filename}`);
    }
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

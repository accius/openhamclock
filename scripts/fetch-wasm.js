#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const REPO = process.env.WASM_REPO || 'accius/openhamclock';
const TAG = process.env.WASM_RELEASE_TAG || 'wasm-latest';
const DEST_DIR = path.join('public', 'wasm');
const BASE_URL = `https://github.com/${REPO}/releases/download/${TAG}`;

const warn = (message) => {
  console.error(`⚠  fetch-wasm: ${message} — skipping (runtime will use REST fallback)`);
  process.exit(0);
};

const FALLBACK = {
  p533: 'runtime will use REST fallback',
  ft8: 'the Decoder panel FT8 tab will report the decoder as not installed',
};
const warnPackage = (name, message) => {
  console.error(`⚠  fetch-wasm: ${name}: ${message} — skipping (${FALLBACK[name] || 'feature unavailable'})`);
};

const download = (url, dest) => {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const location = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, url).toString();
        response.resume(); // drain and close the redirected response
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
};

const sha256File = async (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
};

/**
 * Verify checksum of files in destination folder. The package's .sha256 file should exist and contain checksum information.
 * @param {*} destDir Destination directory where files are downloaded.
 * @param {*} filesExpected List of expected files to verify, the first file in the list should be the checksum file (e.g. p533.sha256) and the rest are files to verify (e.g. p533.mjs, p533.wasm).
 * @returns returns true if checksum file exists and matches, false if checksum file is missing or invalid
 */
const verifyChecksum = async (destDir, filesExpected) => {
  const checksumFile = path.join(destDir, filesExpected[0]);
  if (!fs.existsSync(checksumFile)) return false;

  const lines = fs
    .readFileSync(checksumFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // skipping the first file which is the checksum file itself, verify that all files in the expected files list are part of the checksum file
  const filesInChecksum = new Set(lines.map((line) => line.split(/\s+/)[1]));
  for (let i = 1; i < filesExpected.length; i++) {
    if (!filesInChecksum.has(filesExpected[i])) return false;
  }

  // for each line in the checksum file, verify that the file exists and matches the expected checksum
  for (const line of lines) {
    const [expected, filename] = line.split(/\s+/);
    if (!expected || !filename) return false;
    const filePath = path.join(destDir, filename);
    if (!fs.existsSync(filePath)) return false;
    const actual = await sha256File(filePath);
    if (expected !== actual) return false;
  }

  return true;
};

/**
 * WASM packages published to the wasm-latest release by
 * .github/workflows/build-wasm.yml. Each is fetched independently: a missing
 * asset (e.g. ft8 before CI has published it for the first time) or a network
 * failure only skips that package — the app falls back (P.533 → REST
 * prediction, FT8 → tab shows "decoder not installed") and the build goes on.
 */
const PACKAGES = [
  { name: 'p533', files: ['p533.sha256', 'p533.mjs', 'p533.wasm'] },
  { name: 'ft8', files: ['ft8.sha256', 'ft8.mjs', 'ft8.wasm'] },
];

async function fetchPackage({ name, files: filesExpected }) {
  // download checksum file to a temporary file first, then replace existing file only on success
  {
    const checksumFileName = filesExpected[0];
    const url = `${BASE_URL}/${checksumFileName}`;
    const dest = path.join(DEST_DIR, checksumFileName);
    const tmpDest = dest + '.tmp';
    try {
      fs.rmSync(tmpDest, { force: true });
      await download(url, tmpDest);
      fs.rmSync(dest, { force: true }); // overwrite existing file only after successful download
      fs.renameSync(tmpDest, dest);
    } catch (err) {
      // cleanup temp file on error, let the caller handle the warning
      try {
        fs.rmSync(tmpDest, { force: true });
      } catch (e) {}
      throw err;
    }
  }

  // if checksum is OK then skip else do a full download of all files and verify again
  if (await verifyChecksum(DEST_DIR, filesExpected)) {
    console.log(`✓ fetch-wasm: ${name} already installed at '${DEST_DIR}'`);
    return;
  }
  console.log(`→ fetch-wasm: downloading ${name} from '${BASE_URL}'...`);
  for (const filename of filesExpected.slice(1)) {
    await download(`${BASE_URL}/${filename}`, path.join(DEST_DIR, filename));
  }
  if ((await verifyChecksum(DEST_DIR, filesExpected)) === false) {
    // never leave a half-verified package behind for the app to load
    for (const filename of filesExpected) fs.rmSync(path.join(DEST_DIR, filename), { force: true });
    throw new Error(`sha256 mismatch, verifyChecksum failed after ${name} download`);
  }
  console.log(`✓ fetch-wasm: ${name} installed to '${DEST_DIR}'`);
  console.log(
    filesExpected
      .slice(1)
      .map((f) => `- ${f}`)
      .join('\n'),
  );
}

(async () => {
  try {
    if (!fs.existsSync(DEST_DIR)) {
      fs.mkdirSync(DEST_DIR, { recursive: true });
    }
  } catch (error) {
    warn(error.message);
  }
  const only = (process.env.WASM_PACKAGES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pkg of PACKAGES) {
    if (only.length && !only.includes(pkg.name)) continue;
    try {
      await fetchPackage(pkg);
    } catch (error) {
      warnPackage(pkg.name, error.message);
    }
  }
})();

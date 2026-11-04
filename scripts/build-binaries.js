#!/usr/bin/env node
/**
 * Build standalone OpenHamClock executables with @yao-pkg/pkg.
 *
 * Each executable bundles Node.js, the server, the built frontend (dist/)
 * and public/ into one file. Users download, run, and open a browser —
 * no Node.js, git or npm needed. Settings and data are written next to
 * the executable (or to OPENHAMCLOCK_HOME) — see server/utils/appPaths.js.
 *
 * Usage:
 *   npm run build                      # frontend must be built first
 *   node scripts/build-binaries.js                 # current platform only
 *   node scripts/build-binaries.js --all           # every target below
 *   node scripts/build-binaries.js --targets linux-arm64,win-x64
 *
 * Output: release/openhamclock-v<version>-<platform>.{tar.gz|zip}
 * The bundled assets are listed under "pkg.assets" in package.json.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release');
const NODE_RANGE = 'node22';

// name → pkg target suffix. Names are what users see in the release list.
const TARGETS = {
  'win-x64': 'win-x64',
  'macos-arm64': 'macos-arm64', // Apple Silicon
  'macos-x64': 'macos-x64', // Intel Mac
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64', // Raspberry Pi 3/4/5 on 64-bit Raspberry Pi OS
  'linux-armv7': 'linuxstatic-armv7', // 32-bit Raspberry Pi OS — best effort
};
// Targets whose failure must not fail the whole build.
const OPTIONAL = new Set(['linux-armv7']);

const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkgJson.version;

function currentTarget() {
  const p = os.platform();
  const a = os.arch();
  if (p === 'win32') return 'win-x64';
  if (p === 'darwin') return a === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (a === 'arm64') return 'linux-arm64';
  if (a === 'arm') return 'linux-armv7';
  return 'linux-x64';
}

function parseArgs(argv) {
  if (argv.includes('--all')) return Object.keys(TARGETS);
  const i = argv.indexOf('--targets');
  if (i !== -1 && argv[i + 1]) {
    const names = argv[i + 1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) {
      if (!TARGETS[n]) {
        console.error(`Unknown target "${n}". Known: ${Object.keys(TARGETS).join(', ')}`);
        process.exit(2);
      }
    }
    return names;
  }
  return [currentTarget()];
}

function readmeText(name) {
  const isWin = name.startsWith('win');
  const exe = isWin ? 'openhamclock.exe' : './openhamclock';
  return [
    `OpenHamClock v${VERSION} — ${name}`,
    '',
    'Run it:',
    isWin ? '  Double-click openhamclock.exe (or run it from a terminal).' : `  ${exe}`,
    !isWin && name.startsWith('macos')
      ? '  macOS: the first launch may be blocked as "from an unidentified developer".\n' +
        '  Right-click the file → Open, or run:  xattr -d com.apple.quarantine openhamclock'
      : null,
    !isWin && name.startsWith('linux') ? '  If needed:  chmod +x openhamclock' : null,
    '',
    'A browser window opens automatically when launched from a desktop; otherwise',
    'open the address printed in the terminal (http://localhost:3001 by default).',
    'The setup wizard asks for your callsign and grid.',
    '',
    'Settings and data (.env, config.json, data/) are created next to this file.',
    'Edit .env to change PORT, or set BIND_HOST=127.0.0.1 to keep it on this computer only.',
    'Set OPENHAMCLOCK_HOME=/some/dir to keep settings and data elsewhere.',
    '',
    'Updating: download the new release and replace this file. Your .env, config.json',
    'and data/ folder are kept.',
    '',
    'Docs: https://github.com/accius/openhamclock/blob/main/docs/QUICKSTART.md',
    '73 de OpenHamClock contributors',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

// Always argv arrays, never a shell string: paths under ROOT/OUT are absolute
// and a shell would re-parse them (CodeQL js/shell-command-injection-from-environment).
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] || ''} exited with status ${r.status}`);
}
// npm's launcher is npx.cmd on Windows; the release workflow builds on Linux/macOS.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function build(name) {
  const stage = path.join(OUT, `stage-${name}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const isWin = name.startsWith('win');
  const binName = isWin ? 'openhamclock.exe' : 'openhamclock';
  const binPath = path.join(stage, binName);
  const target = `${NODE_RANGE}-${TARGETS[name]}`;

  console.log(`\n▶ ${name}  (${target})`);
  // --no-bytecode: pkg otherwise compiles sources to V8 bytecode by spawning a
  // node binary of the *target's* CPU architecture, which fails when
  // cross-building (Pi/arm64 from an x64 runner, Windows from a Mac). The
  // sources are public anyway; startup cost of compiling them is negligible.
  run(NPX, [
    '--yes',
    '@yao-pkg/pkg',
    'server.js',
    '--target',
    target,
    '--output',
    binPath,
    '--compress',
    'GZip',
    '--no-bytecode',
    '--public',
    '--public-packages',
    '*',
  ]);

  // Ad-hoc sign macOS binaries when building on a Mac (pkg signs too; this is
  // belt-and-braces so Apple Silicon does not refuse to launch it).
  if (name.startsWith('macos') && process.platform === 'darwin') {
    const r = spawnSync('codesign', ['--force', '--sign', '-', binPath], { stdio: 'inherit' });
    if (r.status !== 0) console.warn('  codesign not available — relying on pkg signature');
  }
  if (!isWin) fs.chmodSync(binPath, 0o755);

  fs.writeFileSync(path.join(stage, 'README.txt'), readmeText(name) + '\n');

  const base = `openhamclock-v${VERSION}-${name}`;
  let archive;
  if (isWin) {
    archive = path.join(OUT, `${base}.zip`);
    fs.rmSync(archive, { force: true });
    if (process.platform === 'win32') {
      run('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -LiteralPath '${path.join(stage, '*')}' -DestinationPath '${archive}'`,
      ]);
    } else {
      run('zip', ['-q', '-j', archive, binPath, path.join(stage, 'README.txt')]);
    }
  } else {
    archive = path.join(OUT, `${base}.tar.gz`);
    fs.rmSync(archive, { force: true });
    run('tar', ['-czf', archive, '-C', stage, binName, 'README.txt']);
  }
  fs.rmSync(stage, { recursive: true, force: true });

  const mb = (fs.statSync(archive).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${path.relative(ROOT, archive)} (${mb} MB)`);
}

function main() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('dist/index.html not found — run `npm run build` first.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const names = parseArgs(process.argv.slice(2));
  console.log(`Building OpenHamClock v${VERSION} executables: ${names.join(', ')}`);

  const failed = [];
  for (const name of names) {
    try {
      build(name);
    } catch (e) {
      console.error(`❌ ${name} failed: ${e.message}`);
      failed.push(name);
    } finally {
      fs.rmSync(path.join(OUT, `stage-${name}`), { recursive: true, force: true });
    }
  }

  const fatal = failed.filter((n) => !OPTIONAL.has(n));
  if (failed.length) console.log(`\nFailed: ${failed.join(', ')}${fatal.length ? '' : ' (optional targets only)'}`);
  console.log(`\nDone. Archives are in ${path.relative(ROOT, OUT)}/`);
  process.exit(fatal.length ? 1 : 0);
}

main();

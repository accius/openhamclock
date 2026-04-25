#!/usr/bin/env node
/**
 * Build helper — creates standalone executables for rig-bridge.
 *
 * Usage:
 *   node build.js              Build for current OS
 *   node build.js --all        Build for all platforms (CI/CD)
 *
 * Requires: npm install (serialport must be installed first)
 * Uses: @yao-pkg/pkg (auto-downloaded via npx)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

// Check dependencies are installed
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('Installing dependencies...');
  execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
}

const buildAll = process.argv.includes('--all');

function build(target, output) {
  console.log(`\nBuilding: ${output}...`);
  const cmd = `npx --yes @yao-pkg/pkg . --target ${target} --output ${path.join('dist', output)} --compress GZip`;
  try {
    execSync(cmd, { cwd: __dirname, stdio: 'inherit' });
    const stat = fs.statSync(path.join(distDir, output));
    const mb = (stat.size / 1024 / 1024).toFixed(1);
    console.log(`  ${output} (${mb} MB)`);
  } catch (e) {
    console.error(`  Failed to build ${output}: ${e.message}`);
  }
}

if (buildAll) {
  build('node20-win-x64', 'ohc-rig-bridge-win.exe');
  build('node20-macos-x64', 'ohc-rig-bridge-macos-x64');
  build('node20-macos-arm64', 'ohc-rig-bridge-macos-arm');
  build('node20-linux-x64', 'ohc-rig-bridge-linux-x64');
  build('node20-linux-arm64', 'ohc-rig-bridge-linux-arm64');
} else {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    build('node20-win-x64', 'ohc-rig-bridge-win.exe');
  } else if (platform === 'darwin' && arch === 'arm64') {
    build('node20-macos-arm64', 'ohc-rig-bridge-macos-arm');
  } else if (platform === 'darwin') {
    build('node20-macos-x64', 'ohc-rig-bridge-macos-x64');
  } else if (arch === 'arm64' || arch === 'aarch64') {
    build('node20-linux-arm64', 'ohc-rig-bridge-linux-arm64');
  } else {
    build('node20-linux-x64', 'ohc-rig-bridge-linux-x64');
  }
}

console.log('\nDone! Executables are in the rig-bridge/dist/ folder.\n');

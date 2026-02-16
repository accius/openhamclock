#!/usr/bin/env node
/**
 * Build helper — creates a standalone executable for the current platform.
 * 
 * Usage:
 *   node build.js              Build for current OS
 *   node build.js --all        Build for all platforms (from GitHub Actions)
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

// Check serialport is installed
if (!fs.existsSync(path.join(__dirname, 'node_modules', 'serialport'))) {
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
    console.log(`✅ ${output} (${mb} MB)`);
  } catch (e) {
    console.error(`❌ Failed to build ${output}: ${e.message}`);
  }
}

if (buildAll) {
  // Build all platforms (for CI)
  build('node18-win-x64', 'rig-listener-win-x64.exe');
  build('node18-macos-x64', 'rig-listener-mac-x64');
  build('node18-macos-arm64', 'rig-listener-mac-arm64');
  build('node18-linux-x64', 'rig-listener-linux-x64');
} else {
  // Build for current platform only
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    build('node18-win-x64', 'rig-listener-win-x64.exe');
  } else if (platform === 'darwin' && arch === 'arm64') {
    build('node18-macos-arm64', 'rig-listener-mac-arm64');
  } else if (platform === 'darwin') {
    build('node18-macos-x64', 'rig-listener-mac-x64');
  } else {
    build('node18-linux-x64', 'rig-listener-linux-x64');
  }
}

console.log('\nDone! Executables are in the dist/ folder.\n');

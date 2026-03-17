/**
 * Git auto-update system — checks for updates and applies them.
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

/**
 * Create the auto-update service.
 * @param {object} ctx - Shared context
 * @returns {object} { autoUpdateState, autoUpdateTick, startAutoUpdateScheduler, hasGitUpdates }
 */
function createAutoUpdateService(ctx) {
  const { ROOT_DIR, AUTO_UPDATE_ENABLED, AUTO_UPDATE_INTERVAL_MINUTES, logInfo, logWarn, logErrorOnce } = ctx;

  const AUTO_UPDATE_ON_START = process.env.AUTO_UPDATE_ON_START === 'true';
  const AUTO_UPDATE_EXIT_AFTER = process.env.AUTO_UPDATE_EXIT_AFTER !== 'false';

  const autoUpdateState = {
    inProgress: false,
    lastCheck: 0,
    lastResult: '',
  };

  function execFilePromise(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, options, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      });
    });
  }

  // Detect default branch (main or master) — cached after first call
  let _defaultBranch = null;
  async function getDefaultBranch() {
    if (_defaultBranch) return _defaultBranch;
    try {
      await execFilePromise('git', ['rev-parse', '--verify', 'origin/main'], {
        cwd: ROOT_DIR,
      });
      _defaultBranch = 'main';
    } catch {
      _defaultBranch = 'master';
    }
    return _defaultBranch;
  }

  async function hasGitUpdates() {
    // Ensure remote URL is correct
    try {
      const { stdout: url } = await execFilePromise('git', ['remote', 'get-url', 'origin'], { cwd: ROOT_DIR });
      if (!url.trim()) {
        await execFilePromise('git', ['remote', 'add', 'origin', 'https://github.com/accius/openhamclock.git'], {
          cwd: ROOT_DIR,
        });
      }
    } catch {
      try {
        await execFilePromise('git', ['remote', 'add', 'origin', 'https://github.com/accius/openhamclock.git'], {
          cwd: ROOT_DIR,
        });
      } catch {} // already exists
    }

    await execFilePromise('git', ['fetch', 'origin', '--prune'], {
      cwd: ROOT_DIR,
    });

    _defaultBranch = null;
    const branch = await getDefaultBranch();
    const local = (await execFilePromise('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR })).stdout.trim();
    const remote = (
      await execFilePromise('git', ['rev-parse', `origin/${branch}`], {
        cwd: ROOT_DIR,
      })
    ).stdout.trim();
    return { updateAvailable: local !== remote, local, remote };
  }

  // Prevent chmod changes from showing as dirty
  if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
    try {
      execFile('git', ['config', 'core.fileMode', 'false'], { cwd: ROOT_DIR }, () => {});
      execFile('git', ['config', '--global', '--add', 'safe.directory', ROOT_DIR], { cwd: ROOT_DIR }, () => {});
    } catch {}
  }

  async function hasDirtyWorkingTree() {
    const status = await execFilePromise('git', ['status', '--porcelain'], {
      cwd: ROOT_DIR,
    });
    return status.stdout.trim().length > 0;
  }

  function spawnPromise(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: ROOT_DIR, stdio: 'inherit', ...options });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) return resolve();
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }

  async function runUpdateScript() {
    const isWin = process.platform === 'win32';

    if (!isWin) {
      const scriptPath = path.join(ROOT_DIR, 'scripts', 'update.sh');
      return spawnPromise('bash', [scriptPath, '--auto']);
    }

    logInfo('[Auto Update] Running cross-platform update (Windows)');

    const branch = await getDefaultBranch();
    const npmCmd = isWin ? 'npm.cmd' : 'npm';

    try {
      await spawnPromise('git', ['pull', 'origin', branch]);
    } catch {
      logWarn('[Auto Update] git pull failed — falling back to hard reset');
      await execFilePromise('git', ['fetch', 'origin', '--prune'], { cwd: ROOT_DIR });
      await execFilePromise('git', ['reset', '--hard', `origin/${branch}`], { cwd: ROOT_DIR });
    }

    logInfo('[Auto Update] Installing dependencies...');
    await spawnPromise(npmCmd, ['install', '--include=dev']);

    const distPath = path.join(ROOT_DIR, 'dist');
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true });
    }

    logInfo('[Auto Update] Building frontend...');
    await spawnPromise(npmCmd, ['run', 'build']);

    logInfo('[Auto Update] Windows update complete');
  }

  async function autoUpdateTick(trigger = 'interval', force = false) {
    if ((!AUTO_UPDATE_ENABLED && !force) || autoUpdateState.inProgress) return;
    autoUpdateState.inProgress = true;
    autoUpdateState.lastCheck = Date.now();

    try {
      if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
        autoUpdateState.lastResult = 'not-git';
        logWarn('[Auto Update] Skipped - not a git repository');
        return;
      }

      try {
        await execFilePromise('git', ['--version']);
      } catch {
        autoUpdateState.lastResult = 'no-git';
        logWarn('[Auto Update] Skipped - git not installed');
        return;
      }

      if (await hasDirtyWorkingTree()) {
        logInfo('[Auto Update] Stashing local changes before update');
        try {
          await execFilePromise('git', ['stash', '--include-untracked'], {
            cwd: ROOT_DIR,
          });
        } catch (stashErr) {
          logWarn('[Auto Update] Stash failed, resetting tracked files');
          await execFilePromise('git', ['checkout', '.'], { cwd: ROOT_DIR });
        }
      }

      const { updateAvailable } = await hasGitUpdates();
      if (!updateAvailable) {
        autoUpdateState.lastResult = 'up-to-date';
        logInfo(`[Auto Update] Up to date (${trigger})`);
        return;
      }

      autoUpdateState.lastResult = 'updating';
      logInfo('[Auto Update] Updates available - running update script');
      await runUpdateScript();
      autoUpdateState.lastResult = 'updated';
      logInfo('[Auto Update] Update complete');

      if (AUTO_UPDATE_EXIT_AFTER) {
        logInfo('[Auto Update] Restarting service (exit 75)...');
        process.exit(75);
      }
    } catch (err) {
      autoUpdateState.lastResult = 'error';
      logErrorOnce('Auto Update', err.message);
    } finally {
      autoUpdateState.inProgress = false;
    }
  }

  function startAutoUpdateScheduler() {
    if (!AUTO_UPDATE_ENABLED) return;
    const intervalMinutes =
      Number.isFinite(AUTO_UPDATE_INTERVAL_MINUTES) && AUTO_UPDATE_INTERVAL_MINUTES > 0
        ? AUTO_UPDATE_INTERVAL_MINUTES
        : 60;
    const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

    logInfo(`[Auto Update] Enabled - every ${intervalMinutes} minutes`);

    if (AUTO_UPDATE_ON_START) {
      setTimeout(() => autoUpdateTick('startup'), 30000);
    }

    setInterval(() => autoUpdateTick('interval'), intervalMs);
  }

  return {
    autoUpdateState,
    autoUpdateTick,
    startAutoUpdateScheduler,
    hasGitUpdates,
  };
}

module.exports = createAutoUpdateService;

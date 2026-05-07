#!/bin/bash
# OpenHamClock Update Script
# Updates to the latest version while preserving your configuration

set -e

# Auto-update mode (non-interactive)
AUTO_MODE=false
for arg in "$@"; do
    case "$arg" in
        --auto|-y|--yes)
            AUTO_MODE=true
            ;;
    esac
done

echo "╔═══════════════════════════════════════════════════════╗"
echo "║           OpenHamClock Update Script                  ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Check if we're in the right directory
if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the openhamclock directory"
    echo "   cd /path/to/openhamclock"
    echo "   bash scripts/update.sh"
    exit 1
fi

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed"
    echo "   sudo apt install git"
    exit 1
fi

# Check if this is a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: This doesn't appear to be a git repository"
    echo "   If you installed from a zip file, you'll need to:"
    echo "   1. Back up your .env file"
    echo "   2. Download the new version"
    echo "   3. Extract and copy your .env back"
    exit 1
fi

# Prevent file permission changes from being detected as modifications
# (e.g. chmod +x on scripts, different umask on Pi vs desktop)
git config core.fileMode false 2>/dev/null

# Mark this directory as safe for git (fixes "dubious ownership" errors
# when the server runs as a different user than the repo owner, e.g.
# systemd running as root but the repo owned by the 'pi' user)
git config --global --add safe.directory "$(pwd)" 2>/dev/null || true

# Save version BEFORE update so we can verify it changed
OLD_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"//;s/".*//')

echo "📋 Current version: $OLD_VERSION"

echo ""
echo "🔍 Checking for updates..."

# Ensure remote URL is correct (fixes broken clones or renamed repos)
EXPECTED_URL="https://github.com/accius/openhamclock.git"
CURRENT_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$CURRENT_URL" ]; then
    echo "   ⚠️  No origin remote — adding it..."
    git remote add origin "$EXPECTED_URL"
elif [ "$CURRENT_URL" != "$EXPECTED_URL" ] && [ "$CURRENT_URL" != "https://github.com/accius/openhamclock" ]; then
    echo "   ⚠️  Fixing remote URL: $CURRENT_URL → $EXPECTED_URL"
    git remote set-url origin "$EXPECTED_URL"
fi

# Fetch latest changes (--prune removes stale remote refs)
git fetch origin --prune 2>&1 || {
    echo "❌ Error: git fetch failed. Check your internet connection."
    exit 1
}

# Detect the default branch (main or master)
if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BRANCH="main"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
    BRANCH="master"
else
    echo "❌ Error: Could not find origin/main or origin/master"
    echo "   Remote URL: $(git remote get-url origin 2>/dev/null || echo 'not set')"
    echo "   Try: git remote set-url origin $EXPECTED_URL"
    exit 1
fi

# Ensure we're on the correct local branch (not detached HEAD)
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -z "$CURRENT_BRANCH" ]; then
    echo "   ⚠️  Detached HEAD detected — checking out $BRANCH..."
    git checkout -B "$BRANCH" "origin/$BRANCH" 2>&1 || git checkout "$BRANCH" 2>&1 || {
        echo "   ❌ Could not checkout $BRANCH — trying hard reset"
        git reset --hard "origin/$BRANCH"
    }
elif [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "   ⚠️  On branch '$CURRENT_BRANCH', switching to '$BRANCH'..."
    git checkout "$BRANCH" 2>&1 || {
        echo "   ❌ Could not switch to $BRANCH"
        exit 1
    }
fi

# Set upstream tracking if not configured
git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true

# Check if there are updates
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$BRANCH)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✅ Already up to date!"
    exit 0
fi

echo "📦 Updates available!"
echo ""

# Show what's new
echo "📝 Changes since your version:"
git log --oneline HEAD..origin/$BRANCH
echo ""

# Confirm update
if [ "$AUTO_MODE" = true ]; then
    echo "🔄 Auto-update enabled — proceeding without prompt"
else
    read -p "🔄 Do you want to update? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Update cancelled"
        exit 0
    fi
fi

echo ""
echo "🛡️  Backing up configuration..."

# Backup .env if it exists
if [ -f ".env" ]; then
    cp .env .env.backup
    echo "   ✓ .env → .env.backup"
fi

# Backup any other local config
if [ -f "config.json" ]; then
    cp config.json config.json.backup
    echo "   ✓ config.json → config.json.backup"
fi

# Backup rig control daemon config
if [ -f "rig-control/rig-config.json" ]; then
    cp rig-control/rig-config.json rig-control/rig-config.json.backup
    echo "   ✓ rig-control/rig-config.json → rig-config.json.backup"
fi

echo ""
echo "⬇️  Pulling latest changes..."

# Preserve Pi helper scripts — these are generated by setup-pi.sh and live
# in the repo root but are NOT tracked by git.  git stash --include-untracked
# would swallow them, and we never pop the stash, so they'd vanish.
PRESERVED_SCRIPTS=()
for f in kiosk.sh start.sh stop.sh restart.sh status.sh; do
    if [ -f "$f" ]; then
        cp "$f" "/tmp/ohc_preserve_${f}"
        PRESERVED_SCRIPTS+=("$f")
    fi
done

# Stash any local changes (permission changes, build artifacts, etc.)
if [ -n "$(git status --porcelain)" ]; then
    echo "   Stashing local changes..."
    git stash --include-untracked 2>&1 || {
        echo "   ⚠️  Stash failed, resetting tracked files..."
        git checkout . 2>&1 || true
    }
fi

# Pull latest (with fallback to hard reset if pull fails)
if ! git pull origin $BRANCH 2>&1; then
    echo "   ⚠️  git pull failed — falling back to hard reset..."
    if ! git fetch origin --prune 2>&1; then
        echo "   ❌ git fetch also failed — check internet connection and permissions"
        exit 1
    fi
    git reset --hard "origin/$BRANCH"
fi

# Verify git operations actually updated the files
POST_PULL_HEAD=$(git rev-parse HEAD)
if [ "$LOCAL" = "$POST_PULL_HEAD" ]; then
    echo ""
    echo "   ⚠️  git pull did not advance HEAD — attempting hard reset..."
    git reset --hard "origin/$BRANCH"
    POST_PULL_HEAD=$(git rev-parse HEAD)
    if [ "$LOCAL" = "$POST_PULL_HEAD" ]; then
        echo "   ❌ Hard reset also failed. Please try manually:"
        echo "      cd $(pwd)"
        echo "      git fetch origin"
        echo "      git reset --hard origin/$BRANCH"
        exit 1
    fi
fi

# Restore execute permissions on scripts (git pull may reset them)
chmod +x scripts/*.sh 2>/dev/null || true

# Restore preserved helper scripts
for f in "${PRESERVED_SCRIPTS[@]}"; do
    if [ -f "/tmp/ohc_preserve_${f}" ]; then
        cp "/tmp/ohc_preserve_${f}" "$f"
        chmod +x "$f"
        rm -f "/tmp/ohc_preserve_${f}"
        echo "   ✓ Restored $f"
    fi
done

echo ""
echo "📦 Installing dependencies..."
# npm ci deletes node_modules and reinstalls from the lockfile exactly,
# preventing stale packages from surviving across updates (e.g. a newly added
# production dependency not appearing in an existing node_modules tree).
# --ignore-scripts skips postinstall hooks that fail on Linux/Pi (e.g.
# electron-winstaller copying Windows-only binaries).
# ELECTRON_SKIP_BINARY_DOWNLOAD=1 avoids downloading the ~200 MB Electron
# binary which is not needed for the server/kiosk build.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts

echo ""
echo "📦 Downloading vendor assets..."
bash scripts/vendor-download.sh 2>/dev/null || echo "   ⚠ Vendor download failed — will fall back to CDN"

echo ""
echo "🔨 Building frontend..."
# Remove old dist/ to prevent stale hashed JS chunks from being served
# (browsers may cache old chunks, causing blank screens after update)
rm -rf dist/
npm run build

# Remove dev dependencies after build to free disk space
npm prune --omit=dev

echo ""
echo "🔄 Restoring configuration..."

# Restore .env (should still be there since it's gitignored, but just in case)
if [ -f ".env.backup" ] && [ ! -f ".env" ]; then
    cp .env.backup .env
    echo "   ✓ .env restored from backup"
fi

# Restore config.json if needed
if [ -f "config.json.backup" ] && [ ! -f "config.json" ]; then
    cp config.json.backup config.json
    echo "   ✓ config.json restored from backup"
fi

# Restore rig control daemon config
if [ -f "rig-control/rig-config.json.backup" ]; then
    cp rig-control/rig-config.json.backup rig-control/rig-config.json
    echo "   ✓ rig-control/rig-config.json restored from backup"
elif [ ! -f "rig-control/rig-config.json" ] && [ -f "rig-control/rig-config.json.example" ]; then
    # First-time setup: copy example to actual config
    cp rig-control/rig-config.json.example rig-control/rig-config.json
    echo "   ✓ rig-control/rig-config.json created from example template"
fi

# Patch kiosk.sh if present — fix --incognito flag that wipes localStorage on reboot
if [ -f "kiosk.sh" ]; then
    if grep -q "\-\-incognito" kiosk.sh; then
        echo ""
        echo "🔧 Patching kiosk.sh..."
        # Remove --incognito line and add --user-data-dir for persistent localStorage
        sed -i '/--incognito/d' kiosk.sh
        # Add user-data-dir if not already present
        if ! grep -q "user-data-dir" kiosk.sh; then
            sed -i 's|--disable-pinch \\|--disable-pinch \\\n    --user-data-dir=$HOME/.config/openhamclock-kiosk \\|' kiosk.sh
        fi
        # Add crash lock cleanup if not present
        if ! grep -q "exited_cleanly" kiosk.sh; then
            sed -i '/# Trap Ctrl+Q/i \
# Clean up any crash lock files from unclean shutdown\
KIOSK_PROFILE="$HOME/.config/openhamclock-kiosk"\
mkdir -p "$KIOSK_PROFILE"\
sed -i '"'"'s/"exited_cleanly":false/"exited_cleanly":true/'"'"' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true\
sed -i '"'"'s/"exit_type":"Crashed"/"exit_type":"Normal"/'"'"' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true\
' kiosk.sh
        fi
        echo "   ✓ Removed --incognito flag (was preventing settings from saving)"
        echo "   ✓ Added dedicated profile directory for persistent localStorage"
        echo "   ⚠️  Reboot your Pi for this fix to take effect"
    fi
fi

# Verify the update actually changed the version
NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"//;s/".*//')

echo ""
if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo "📋 Version: $NEW_VERSION (unchanged — update may have included non-version changes)"
else
    echo "📋 Updated: $OLD_VERSION → $NEW_VERSION"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║               ✅ Update Complete!                     ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "🔄 Restart the server to apply changes:"
echo ""

# Check if running as systemd service
if systemctl is-active --quiet openhamclock 2>/dev/null; then
    echo "   sudo systemctl restart openhamclock"
else
    echo "   # If running in terminal, press Ctrl+C and run:"
    echo "   npm start"
    echo ""
    echo "   # If running as a service:"
    echo "   sudo systemctl restart openhamclock"
fi

echo ""
echo "📖 See CHANGELOG.md for what's new"
echo ""

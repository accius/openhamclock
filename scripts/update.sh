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
    echo "   ./scripts/update.sh"
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

echo "📋 Current version:"
grep '"version"' package.json | head -1

echo ""
echo "🔍 Checking for updates..."

# Fetch latest changes
git fetch origin

# Detect the default branch (main or master)
if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BRANCH="main"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
    BRANCH="master"
else
    echo "❌ Error: Could not find origin/main or origin/master"
    exit 1
fi

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

echo ""
echo "⬇️  Pulling latest changes..."

# Stash any local changes (permission changes, build artifacts, etc.)
if [ -n "$(git status --porcelain)" ]; then
    echo "   Stashing local changes..."
    git stash --include-untracked 2>/dev/null || git checkout . 2>/dev/null
fi

git pull origin $BRANCH

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔨 Building frontend..."
npm run build

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

echo ""
echo "📋 New version:"
grep '"version"' package.json | head -1

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

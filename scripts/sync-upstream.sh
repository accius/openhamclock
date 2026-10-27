#!/usr/bin/env bash
# ==============================================================================
# scripts/sync-upstream.sh - Sync with upstream repo and auto-update AUR & Snap
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="Staging"
ORIGIN_REMOTE="origin"
ORIGIN_BRANCH="Staging"

AUTO_PUSH=false
BUILD_SNAP=false
UPLOAD_SNAP=false
FORCE=false

# Process flags
for arg in "$@"; do
    case "$arg" in
        --push)
            AUTO_PUSH=true
            ;;
        --snap)
            BUILD_SNAP=true
            ;;
        --upload-snap)
            BUILD_SNAP=true
            UPLOAD_SNAP=true
            ;;
        --force|-f)
            FORCE=true
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --push          Automatically push to origin/Staging and AUR"
            echo "  --snap          Build Snap package locally after sync"
            echo "  --upload-snap   Build and upload Snap package to Snap Store stable channel"
            echo "  --force         Force sync and packaging update even if no new commits"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
    esac
done

cd "${REPO_ROOT}"

echo "=================================================================="
echo "    OpenHamClock Upstream Synchronizer & Package Updater"
echo "=================================================================="

# Ensure git author is strictly 9M2PJU
export GIT_AUTHOR_NAME="9M2PJU"
export GIT_AUTHOR_EMAIL="9m2pju@gmail.com"
export GIT_COMMITTER_NAME="9M2PJU"
export GIT_COMMITTER_EMAIL="9m2pju@gmail.com"

# Check for upstream remote
if ! git remote get-url "${UPSTREAM_REMOTE}" >/dev/null 2>&1; then
    echo "==> Adding upstream remote: https://github.com/accius/openhamclock.git"
    git remote add upstream https://github.com/accius/openhamclock.git
fi

# Fetch upstream commits and tags
echo "==> Fetching from upstream (${UPSTREAM_REMOTE})..."
git fetch --tags "${UPSTREAM_REMOTE}"

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "${CURRENT_BRANCH}" != "${ORIGIN_BRANCH}" ]; then
    echo "==> Switching to ${ORIGIN_BRANCH} branch..."
    git checkout "${ORIGIN_BRANCH}"
fi

# Compare local branch with upstream
LOCAL_HASH=$(git rev-parse HEAD)
UPSTREAM_HASH=$(git rev-parse "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")

echo "    Local (${ORIGIN_BRANCH}):    ${LOCAL_HASH:0:8}"
echo "    Upstream (${UPSTREAM_BRANCH}): ${UPSTREAM_HASH:0:8}"

if [ "${LOCAL_HASH}" = "${UPSTREAM_HASH}" ] && [ "${FORCE}" = "false" ]; then
    echo "==> Local ${ORIGIN_BRANCH} is already up to date with upstream/${UPSTREAM_BRANCH}."
else
    echo "==> Merging upstream/${UPSTREAM_BRANCH} into ${ORIGIN_BRANCH}..."
    git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-edit -m "chore: sync with upstream ${UPSTREAM_BRANCH}" || {
        echo "Error: Conflict during merge with upstream/${UPSTREAM_BRANCH}. Please resolve conflicts." >&2
        exit 1
    }
fi

# Read current version
PKG_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || git describe --tags --always)
echo "==> Current OpenHamClock Version: ${PKG_VERSION}"

# 1. Update AUR package
echo "==> Updating AUR package (openhamclock-git)..."
if [ "${AUTO_PUSH}" = "true" ]; then
    bash "${REPO_ROOT}/scripts/update-aur.sh" --push
else
    bash "${REPO_ROOT}/scripts/update-aur.sh"
fi

# 2. Build / Upload Snap package if requested
if [ "${BUILD_SNAP}" = "true" ]; then
    echo "==> Building Snap package..."
    snapcraft
    if [ "${UPLOAD_SNAP}" = "true" ]; then
        SNAP_FILE=$(ls -t openhamclock_*.snap 2>/dev/null | head -n1)
        if [ -n "${SNAP_FILE}" ]; then
            echo "==> Releasing ${SNAP_FILE} to Snap Store (stable)..."
            snapcraft upload --release=stable "${SNAP_FILE}"
        fi
    fi
fi

# 3. Push to origin/Staging
if [ "${AUTO_PUSH}" = "true" ]; then
    echo "==> Pushing ${ORIGIN_BRANCH} to ${ORIGIN_REMOTE}..."
    git push "${ORIGIN_REMOTE}" "${ORIGIN_BRANCH}" --tags
    echo "==> Successfully pushed ${ORIGIN_BRANCH} to origin!"
else
    echo "==> Sync complete locally."
    echo "    To push to GitHub origin, run: git push ${ORIGIN_REMOTE} ${ORIGIN_BRANCH} --tags"
fi

echo "=================================================================="
echo "  Synchronization & Package Update Completed Successfully!"
echo "  Version: ${PKG_VERSION}"
echo "=================================================================="

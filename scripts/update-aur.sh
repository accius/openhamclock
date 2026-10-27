#!/usr/bin/env bash
# ==============================================================================
# scripts/update-aur.sh - Synchronize and update the openhamclock-git AUR package
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
AUR_SOURCE_DIR="${REPO_ROOT}/aur/openhamclock-git"
AUR_TARGET_DIR="${1:-${HOME}/aur/openhamclock-git}"
AUTO_PUSH="${AUTO_PUSH:-false}"

# Process flags
for arg in "$@"; do
    case "$arg" in
        --push)
            AUTO_PUSH=true
            ;;
        --help|-h)
            echo "Usage: $0 [AUR_TARGET_DIR] [--push]"
            echo "  AUR_TARGET_DIR  Path to local openhamclock-git AUR clone (default: ~/aur/openhamclock-git)"
            echo "  --push          Automatically push changes to aur.archlinux.org"
            exit 0
            ;;
    esac
done

echo "==> [AUR Update] OpenHamClock AUR Package Synchronizer"
echo "    Source directory: ${AUR_SOURCE_DIR}"
echo "    Target directory: ${AUR_TARGET_DIR}"

if [ ! -d "${AUR_SOURCE_DIR}" ]; then
    echo "Error: Source AUR directory ${AUR_SOURCE_DIR} does not exist!" >&2
    exit 1
fi

if [ ! -d "${AUR_TARGET_DIR}/.git" ]; then
    echo "==> Cloning openhamclock-git AUR repo to ${AUR_TARGET_DIR}..."
    mkdir -p "$(dirname "${AUR_TARGET_DIR}")"
    git clone ssh://aur@aur.archlinux.org/openhamclock-git.git "${AUR_TARGET_DIR}"
fi

# Copy all packaging files from repo to AUR directory
echo "==> Synchronizing packaging files..."
cp -f "${AUR_SOURCE_DIR}"/{PKGBUILD,openhamclock.sh,openhamclock.service,openhamclock-user.service,openhamclock.desktop,openhamclock.env,openhamclock.install} "${AUR_TARGET_DIR}/"
[ -f "${AUR_SOURCE_DIR}/.gitignore" ] && cp -f "${AUR_SOURCE_DIR}/.gitignore" "${AUR_TARGET_DIR}/"

# Regenerate .SRCINFO
echo "==> Regenerating .SRCINFO..."
cd "${AUR_TARGET_DIR}"
makepkg --printsrcinfo > .SRCINFO

# Also sync back .SRCINFO to source dir
cp -f "${AUR_TARGET_DIR}/.SRCINFO" "${AUR_SOURCE_DIR}/.SRCINFO"

# Check git status in AUR directory
cd "${AUR_TARGET_DIR}"
if git diff --quiet && git diff --staged --quiet && [ -z "$(git status --porcelain)" ]; then
    echo "==> AUR repository is already up to date. No changes to commit."
else
    echo "==> Changes detected in AUR repository:"
    git status -s

    PKG_VER=$(grep 'pkgver =' .SRCINFO | head -n1 | awk '{print $3}')
    PKG_REL=$(grep 'pkgrel =' .SRCINFO | head -n1 | awk '{print $3}')
    COMMIT_MSG="chore(release): update openhamclock-git to ${PKG_VER}-${PKG_REL}"

    git add PKGBUILD .SRCINFO openhamclock.sh openhamclock.service openhamclock-user.service openhamclock.desktop openhamclock.env openhamclock.install .gitignore 2>/dev/null || git add -A
    git -c user.name="9M2PJU" -c user.email="9m2pju@gmail.com" commit -m "${COMMIT_MSG}" --author="9M2PJU <9m2pju@gmail.com>"

    echo "==> Committed AUR update: ${COMMIT_MSG}"

    if [ "${AUTO_PUSH}" = "true" ]; then
        echo "==> Pushing changes to ssh://aur@aur.archlinux.org/openhamclock-git.git..."
        git push origin master
        echo "==> Successfully pushed to AUR!"
    else
        echo "==> Ready to push. Run:"
        echo "    cd \"${AUR_TARGET_DIR}\" && git push origin master"
        echo "    Or run with --push flag to push automatically."
    fi
fi

echo "==> [AUR Update] Done."

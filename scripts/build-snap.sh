#!/bin/bash
# Helper script to build OpenHamClock snap package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "=== Building OpenHamClock Snap Package ==="

if ! command -v snapcraft >/dev/null 2>&1; then
    echo "Error: snapcraft is not installed. Install via snap: sudo snap install snapcraft --classic"
    exit 1
fi

snapcraft --destructive-mode "$@"

echo "=== Build Complete ==="

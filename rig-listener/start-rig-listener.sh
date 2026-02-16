#!/bin/bash
# OpenHamClock Rig Listener — Mac/Linux launcher
# Just double-click this file (or run: ./start-rig-listener.sh)

echo ""
echo "  ======================================"
echo "   OpenHamClock Rig Listener"
echo "  ======================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "  ❌ Node.js is not installed!"
    echo ""
    echo "  Install it from: https://nodejs.org (LTS version)"
    echo "  Or on Mac:   brew install node"
    echo "  Or on Linux: sudo apt install nodejs npm"
    echo ""
    echo "  After installing, run this script again."
    exit 1
fi

echo "  ✅ Node.js $(node -v) detected"

# Change to script directory
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules/serialport" ]; then
    echo ""
    echo "  📦 Installing dependencies (first time only)..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "  ❌ npm install failed. Check errors above."
        echo ""
        echo "  Common fix on Linux: sudo apt install build-essential"
        echo "  Common fix on Mac:   xcode-select --install"
        exit 1
    fi
    echo ""
fi

# Run the listener
node rig-listener.js "$@"

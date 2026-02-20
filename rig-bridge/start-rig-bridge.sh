#!/bin/bash
# OpenHamClock Rig Bridge Launcher

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  Starting OpenHamClock Rig Bridge..."
echo "  Setup UI: http://localhost:5555"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

if ! command -v node &> /dev/null; then
    echo "  ERROR: Node.js not found."
    echo "  Install from https://nodejs.org or use the standalone binary."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    npm install
    echo ""
fi

# Try to open browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5555 2>/dev/null &
elif command -v open &> /dev/null; then
    open http://localhost:5555 &
fi

node rig-bridge.js

#!/bin/bash
# OpenHamClock Rig Bridge Launcher

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Read version from package.json
VERSION=$(node -e "try{console.log(require('./package.json').version)}catch(e){console.log('?')}" 2>/dev/null || echo "?")

# Read port and TLS setting from config
RB_CFG="$HOME/.config/openhamclock/rig-bridge-config.json"
[ ! -f "$RB_CFG" ] && RB_CFG="$HOME/openhamclock-rig-bridge/rig-bridge-config.json"
SETUP_URL=$(RB_CFG="$RB_CFG" node -e 'try{const c=require(process.env.RB_CFG);const p=c.port||5555;const s=c.tls&&c.tls.enabled;console.log((s?"https":"http")+"://localhost:"+p)}catch(e){console.log("http://localhost:5555")}' 2>/dev/null || echo "http://localhost:5555")

echo ""
echo "  OpenHamClock Rig Bridge v$VERSION"
echo "  Setup UI: $SETUP_URL"
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

# Open browser at the correct URL
if command -v xdg-open &> /dev/null; then
    xdg-open "$SETUP_URL" 2>/dev/null &
elif command -v open &> /dev/null; then
    open "$SETUP_URL" &
fi

node rig-bridge.js

#!/bin/bash

# OpenHamClock Rig Daemon - macOS Installer
# Installs the daemon as a LaunchAgent for the current user

SCRIPT_DIR=$(dirname "$0")
RIG_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
PLIST_NAME="com.openhamclock.rig.plist"
USER_AGENTS_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$USER_AGENTS_DIR/$PLIST_NAME"

echo "Installing OpenHamClock Rig Daemon for macOS..."
echo "Rig Directory: $RIG_DIR"

# Check for node
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed or not in PATH."
    echo "Please install Node.js first (e.g., brew install node)"
    exit 1
fi

NODE_PATH=$(command -v node)
echo "Using Node at: $NODE_PATH"

# Ensure LaunchAgents directory exists
mkdir -p "$USER_AGENTS_DIR"

# Install dependencies
echo "Installing dependencies..."
cd "$RIG_DIR"
npm install

# Copy plist
echo "Configuring LaunchAgent..."
cp "$SCRIPT_DIR/$PLIST_NAME" "$TARGET_PLIST"

# Replace placeholders
sed -i '' "s|{{INSTALL_DIR}}|$RIG_DIR|g" "$TARGET_PLIST"
# Update node path in plist if different from default
sed -i '' "s|/usr/local/bin/node|$NODE_PATH|g" "$TARGET_PLIST"

# Unload if exists
launchctl unload "$TARGET_PLIST" 2>/dev/null

# Load new agent
echo "Starting service..."
launchctl load "$TARGET_PLIST"

echo "--------------------------------------------------"
echo "Success! The rig daemon is running."
echo "Logs: $RIG_DIR/daemon.log"
echo "To stop: launchctl unload $TARGET_PLIST"
echo "--------------------------------------------------"

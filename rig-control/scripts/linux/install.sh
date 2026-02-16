#!/bin/bash

# OpenHamClock Rig Daemon - Linux Installer
# Installs the daemon as a systemd service

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install.sh)"
  exit 1
fi

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
RIG_DIR=$(readlink -f "$SCRIPT_DIR/../..")
SERVICE_NAME="openhamclock-rig.service"
SYSTEMD_PATH="/etc/systemd/system/$SERVICE_NAME"
CURRENT_USER=$(logname)

echo "Installing OpenHamClock Rig Daemon..."
echo "Rig Directory: $RIG_DIR"
echo "Service User:  $CURRENT_USER"

# dependencies check
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js first."
    exit 1
fi

# npm install
echo "Installing dependencies..."
cd "$RIG_DIR"
sudo -u "$CURRENT_USER" npm install

# Create service file from template
echo "Creating systemd service file..."
cp "$SCRIPT_DIR/openhamclock-rig.service" "$SYSTEMD_PATH"

# Replace placeholders
sed -i "s|{{USER}}|$CURRENT_USER|g" "$SYSTEMD_PATH"
sed -i "s|{{INSTALL_DIR}}|$RIG_DIR|g" "$SYSTEMD_PATH"

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable and start
echo "Enabling and starting service..."
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

echo "--------------------------------------------------"
echo "Success! The rig daemon is now running."
echo "View logs with: journalctl -u $SERVICE_NAME -f"
echo "Check status:   systemctl status $SERVICE_NAME"
echo "--------------------------------------------------"

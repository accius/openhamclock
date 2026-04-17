#!/bin/bash
#
# OpenHamClock - Raspberry Pi Setup Script
#
# ═══════════════════════════════════════════════════════════════════
# SUPPORTED HARDWARE
# ═══════════════════════════════════════════════════════════════════
#
#   Raspberry Pi 3B / 3B+   (32-bit and 64-bit Raspberry Pi OS)
#   Raspberry Pi 4           (32-bit and 64-bit Raspberry Pi OS)
#   Raspberry Pi 5           (64-bit Raspberry Pi OS)
#
#   Other Debian-based ARM boards may work but are not tested.
#   Non-Raspberry Pi hardware will trigger a warning and prompt.
#
# ═══════════════════════════════════════════════════════════════════
# SUPPORTED OPERATING SYSTEMS
# ═══════════════════════════════════════════════════════════════════
#
#   Raspberry Pi OS Bookworm  (Debian 12)  — RECOMMENDED
#     Display server : X11 (openbox / LXDE)
#     Kiosk mode     : supported via xset + unclutter + Chromium
#     Boot config    : /boot/firmware/config.txt
#
#   Raspberry Pi OS Trixie    (Debian 13)  — SUPPORTED
#     Display server : Wayland (labwc) by default
#     Kiosk mode     : supported; X11 tools (xset, unclutter) are
#                      skipped automatically; Chromium is launched
#                      with --ozone-platform=wayland instead
#     Boot config    : /boot/firmware/config.txt
#
#   Raspberry Pi OS Bullseye  (Debian 11)  — LEGACY, best-effort
#     Display server : X11
#     Kiosk mode     : supported (same path as Bookworm)
#     Boot config    : /boot/config.txt
#     Note: Bullseye reached end-of-life. Upgrade is strongly advised.
#
# ═══════════════════════════════════════════════════════════════════
# NOT SUPPORTED / OUT OF SCOPE
# ═══════════════════════════════════════════════════════════════════
#
#   • Ubuntu, Manjaro, Fedora, or other non-Raspberry Pi OS distros
#     (different package names, init systems, and display setups)
#   • Raspberry Pi OS Buster (Debian 10) or older
#     (Node 22 LTS is not available via NodeSource for Buster)
#   • Headless-only Pi Zero / Pi Zero 2 W in kiosk mode
#     (--server mode works; --kiosk requires a display)
#   • Windows / macOS / generic x86-64 Linux
#     (see scripts/setup-linux.sh for Linux desktop installs)
#
# ═══════════════════════════════════════════════════════════════════
# PREREQUISITES
# ═══════════════════════════════════════════════════════════════════
#
#   • A clean or up-to-date Raspberry Pi OS install
#   • Internet access during setup (NodeSource, apt, npm, GitHub)
#   • sudo privileges for the running user
#   • At least 1 GB free disk space (build artefacts + node_modules)
#   • At least 512 MB RAM (1 GB+ recommended for the npm build step)
#
# ═══════════════════════════════════════════════════════════════════
# WHAT THIS SCRIPT DOES
# ═══════════════════════════════════════════════════════════════════
#
#   1. Updates system packages (apt-get update && upgrade)
#   2. Installs Node.js 22 LTS via NodeSource
#   3. Installs system dependencies (Chromium, fonts, display tools)
#   4. Clones or updates the OpenHamClock repository
#   5. Runs npm install and npm run build
#   6. Creates /home/<user>/.env from .env.example (if absent)
#   7. Creates and enables a systemd service (openhamclock.service)
#   8. [--kiosk] Writes kiosk.sh that auto-detects Wayland vs X11
#      and launches Chromium in fullscreen on login
#
# ═══════════════════════════════════════════════════════════════════
# KIOSK MODE DETAILS
# ═══════════════════════════════════════════════════════════════════
#
#   The kiosk launcher (~openhamclock/kiosk.sh) is placed in
#   ~/.config/autostart/ and runs on every desktop login.
#
#   At runtime kiosk.sh reads $XDG_SESSION_TYPE to choose the
#   correct display path:
#
#     Wayland  →  Chromium launched with --ozone-platform=wayland
#                 xset / unclutter are NOT called (X11-only tools)
#
#     X11      →  DISPLAY=:0 is set explicitly (not always inherited
#                 from the autostart context), then xset disables the
#                 screensaver and unclutter hides the cursor
#
#   If the OpenHamClock server does not respond within 60 seconds,
#   kiosk.sh exits with an error rather than looping forever.
#
# ═══════════════════════════════════════════════════════════════════
# USAGE
# ═══════════════════════════════════════════════════════════════════
#
#   chmod +x setup-pi.sh
#   ./setup-pi.sh               # server only (no kiosk)
#   ./setup-pi.sh --kiosk       # server + fullscreen kiosk on boot
#   ./setup-pi.sh --server      # headless server, no GUI packages
#   ./setup-pi.sh --help        # show option summary
#
#   After installation, edit ~/openhamclock/.env to set your
#   CALLSIGN and LOCATOR before (re)starting the service.
#

set -e

# Colors for output
RED=$(tput setaf 1)
GREEN=$(tput setaf 2)
YELLOW=$(tput setaf 3; tput bold)
BLUE=$(tput setaf 4)
NC=$(tput sgr0) # No Color

# Configuration
INSTALL_DIR="$HOME/openhamclock"
SERVICE_NAME="openhamclock"
NODE_VERSION="22"

# Print banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║   ██████╗ ██████╗ ███████╗███╗   ██╗                      ║"
echo "║  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║                      ║"
echo "║  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║                      ║"
echo "║  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║                      ║"
echo "║  ╚██████╔╝██║     ███████╗██║ ╚████║                      ║"
echo "║   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝  HAM CLOCK           ║"
echo "║                                                           ║"
echo "║   Raspberry Pi Setup Script                               ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse arguments
KIOSK_MODE=false
SERVER_MODE=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --kiosk) KIOSK_MODE=true ;;
        --server) SERVER_MODE=true ;;
        --help) 
            echo "Usage: ./setup-pi.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --kiosk     Enable kiosk mode (fullscreen, auto-start)"
            echo "  --server    Install as headless server only"
            echo "  --help      Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Check if running on Raspberry Pi
check_raspberry_pi() {
    if [ -f /proc/device-tree/model ]; then
        MODEL=$(cat /proc/device-tree/model)
        echo -e "${GREEN}✓ Detected: $MODEL${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: This doesn't appear to be a Raspberry Pi${NC}"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Update system
update_system() {
    echo -e "${BLUE}>>> Updating system packages...${NC}"
    sudo apt-get update -qq
    # DEBIAN_FRONTEND=noninteractive suppresses dpkg interactive prompts.
    # --force-confold keeps existing config files when a package ships a new version
    # (e.g. rpi-chromium-mods updating master_preferences).
    # --force-confdef handles any remaining unset choices with the package default.
    sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq \
        -o Dpkg::Options::="--force-confold" \
        -o Dpkg::Options::="--force-confdef"
}

# Install Node.js
install_nodejs() {
    echo -e "${BLUE}>>> Installing Node.js ${NODE_VERSION}...${NC}"

    # Check if Node.js is already installed
    if command -v node &> /dev/null; then
        CURRENT_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_VERSION" -ge "$NODE_VERSION" ]; then
            echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
            return
        fi
    fi

    ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)

    if [ "$ARCH" = "armhf" ]; then
        # NodeSource dropped 32-bit ARM (armhf) support from Node.js 20 onwards.
        # The official nodejs.org project still publishes armv7l tarballs, so we
        # download and install those directly instead.
        echo -e "${YELLOW}⚠ 32-bit ARM (armhf) detected — NodeSource does not support this architecture.${NC}"
        echo -e "${BLUE}  Downloading official Node.js ${NODE_VERSION} armv7l binary from nodejs.org...${NC}"

        NODE_DIST_BASE="https://nodejs.org/dist/latest-v${NODE_VERSION}.x"
        NODE_TARBALL=$(curl -fsSL "$NODE_DIST_BASE/" \
            | grep -o "node-v[0-9.]*-linux-armv7l\.tar\.gz" \
            | head -1)

        if [ -z "$NODE_TARBALL" ]; then
            echo -e "${RED}✗ Could not locate a Node.js ${NODE_VERSION} armv7l release on nodejs.org.${NC}"
            exit 1
        fi

        # Download to a temp file with retry support.
        # Piping curl directly into tar gives no retry opportunity on a
        # dropped connection; saving to disk first lets curl resume/retry
        # and keeps extraction separate so errors are easier to diagnose.
        echo -e "${BLUE}  Installing $NODE_TARBALL ...${NC}"
        NODE_TMPFILE=$(mktemp /tmp/nodejs-armv7l-XXXXXX.tar.gz)
        curl -fsSL \
            --retry 3 --retry-delay 5 --retry-connrefused \
            "$NODE_DIST_BASE/$NODE_TARBALL" \
            -o "$NODE_TMPFILE" || {
            rm -f "$NODE_TMPFILE"
            echo -e "${RED}✗ Failed to download Node.js armv7l binary (tried 3 times).${NC}"
            exit 1
        }
        sudo tar -xz -C /usr/local --strip-components=1 -f "$NODE_TMPFILE" || {
            rm -f "$NODE_TMPFILE"
            echo -e "${RED}✗ Failed to extract Node.js armv7l binary.${NC}"
            exit 1
        }
        rm -f "$NODE_TMPFILE"
    else
        # amd64 and arm64 are supported by NodeSource.
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - || {
            echo -e "${RED}✗ NodeSource setup failed. Check your Debian version and internet connection.${NC}"
            exit 1
        }
        sudo apt-get install -y nodejs
    fi

    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
}

# Install dependencies
install_dependencies() {
    echo -e "${BLUE}>>> Installing system dependencies...${NC}"
    
    # fonts-noto-color-emoji: required for emoji icons to render in Chromium on Linux/Pi.
    # Without this package, weather symbols, band indicators, and other emoji display as blank boxes.
    PACKAGES="git fonts-noto-color-emoji"
    
    if [ "$SERVER_MODE" = false ]; then
        # Note: Package is 'chromium' on Raspberry Pi OS Bookworm+, 'chromium-browser' on older versions
        # Try chromium first (newer), fall back to chromium-browser (older)
        PACKAGES="$PACKAGES unclutter xdotool x11-xserver-utils"
        if apt-cache show chromium &>/dev/null; then
            PACKAGES="$PACKAGES chromium"
        else
            PACKAGES="$PACKAGES chromium-browser"
        fi
    fi
    
    sudo apt-get install -y -qq $PACKAGES
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Clone or update repository
setup_repository() {
    echo -e "${BLUE}>>> Setting up OpenHamClock...${NC}"
    
    if [ -d "$INSTALL_DIR" ]; then
        echo "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull
    else
        echo "Cloning repository..."
        git clone https://github.com/accius/openhamclock.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    # Prevent file permission changes from blocking future updates
    git config core.fileMode false 2>/dev/null
    
    # Install npm dependencies.
    # --ignore-scripts skips lifecycle hooks (postinstall, prepare, etc.) that are
    # irrelevant or harmful on ARM Linux — most notably electron-winstaller's
    # postinstall, which tries to copy vendor/7z-arm.exe and fails on a Pi because
    # that Windows-only file is not shipped for Linux targets.
    # Husky git-hooks (prepare) are also skipped, which is fine on a production Pi.
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --include=dev --ignore-scripts

    # Download vendor assets (fonts, Leaflet) for self-hosting — no external CDN requests
    echo -e "${BLUE}>>> Downloading vendor assets for privacy...${NC}"
    bash scripts/vendor-download.sh || echo -e "${YELLOW}⚠ Vendor download failed — will fall back to CDN${NC}"

    # Build frontend for production
    npm run build

    # Remove dev dependencies (electron, electron-builder, etc.) after the build.
    # This frees ~500 MB of node_modules that are not needed at runtime on the Pi.
    npm prune --omit=dev
    
    # Make update script executable
    chmod +x scripts/update.sh 2>/dev/null || true

    # Create .env from the example template if it doesn't exist yet.
    # The example defaults PORT=3001 (dev mode, to avoid conflicts with Vite).
    # On a Pi production install everything runs on port 3000, so override that.
    if [ ! -f .env ]; then
        cp .env.example .env
        # Switch to the production port used by the systemd service and kiosk
        sed -i 's/^PORT=3001$/PORT=3000/' .env
        # Enable server-side settings sync for Pi (single-user kiosk deployment).
        # With SETTINGS_SYNC=true the UI reads/writes its settings (callsign, locator,
        # layout, theme, etc.) from the server instead of browser localStorage.
        # This means editing CALLSIGN and LOCATOR in .env and restarting the service
        # is enough to update what is shown on screen — no manual UI step required.
        sed -i 's/^SETTINGS_SYNC=false$/SETTINGS_SYNC=true/' .env
        echo -e "${YELLOW}⚠ A default .env file has been created at $INSTALL_DIR/.env${NC}"
        echo -e "${YELLOW}  Edit CALLSIGN and LOCATOR in $INSTALL_DIR/.env, then run:${NC}"
        echo -e "${YELLOW}  sudo systemctl restart openhamclock${NC}"
    else
        echo -e "${GREEN}✓ Existing .env kept — not overwritten${NC}"
    fi

    echo -e "${GREEN}✓ OpenHamClock installed to $INSTALL_DIR${NC}"
}

# Create systemd service
create_service() {
    echo -e "${BLUE}>>> Creating systemd service...${NC}"

    # Resolve the node binary path at install time so the service works regardless
    # of whether Node was installed via NodeSource deb, nvm, or any other method.
    NODE_BIN=$(command -v node)
    if [ -z "$NODE_BIN" ]; then
        echo -e "${RED}✗ Cannot find node binary — Node.js installation may have failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}  Using node at: $NODE_BIN${NC}"

    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=OpenHamClock Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=10
SuccessExitStatus=75
Environment=NODE_ENV=production
# PORT is read from .env; set here only as a fallback so the service always
# has a defined value even if .env is missing or PORT is not set there.
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}
    sudo systemctl start ${SERVICE_NAME}
    
    echo -e "${GREEN}✓ Service created and started${NC}"
}

# Setup kiosk mode
setup_kiosk() {
    echo -e "${BLUE}>>> Configuring kiosk mode...${NC}"
    
    # Disable screen blanking (0 = disable, 1 = enable — keep the screen on for kiosk)
    sudo raspi-config nonint do_blanking 0 2>/dev/null || true
    
    # Create autostart directory
    mkdir -p "$HOME/.config/autostart"
    
    # Create kiosk launcher script
    cat > "$INSTALL_DIR/kiosk.sh" << 'EOF'
#!/bin/bash
# OpenHamClock Kiosk Launcher
# Supports Raspberry Pi OS Bookworm (X11) and Trixie (Wayland/labwc)

# Wait for the desktop environment to be ready
sleep 5

# ------------------------------------------------------------------
# Detect display server: Wayland or X11
# $XDG_SESSION_TYPE is set by the session manager on both Bookworm and Trixie.
# Fall back to checking $WAYLAND_DISPLAY in case the variable isn't exported.
# ------------------------------------------------------------------
SESSION_TYPE="${XDG_SESSION_TYPE:-}"
if [ -z "$SESSION_TYPE" ] && [ -n "$WAYLAND_DISPLAY" ]; then
    SESSION_TYPE="wayland"
fi
if [ -z "$SESSION_TYPE" ]; then
    # Last resort: default to x11 so the script always does something useful
    SESSION_TYPE="x11"
fi

echo "OpenHamClock kiosk: detected session type = $SESSION_TYPE"

if [ "$SESSION_TYPE" = "wayland" ]; then
    # ------------------------------------------------------------------
    # Wayland path (Raspberry Pi OS Trixie with labwc)
    # xset and unclutter require an X server — skip them entirely.
    # Screen blanking is disabled system-wide via raspi-config at install time.
    # ------------------------------------------------------------------
    CHROMIUM_EXTRA_FLAGS="--ozone-platform=wayland --enable-features=UseOzonePlatform,WaylandWindowDecorations"
else
    # ------------------------------------------------------------------
    # X11 path (Raspberry Pi OS Bookworm with openbox/LXDE)
    # DISPLAY=:0 must be set explicitly — it is not always inherited when
    # the script is launched from an XDG autostart .desktop file.
    # ------------------------------------------------------------------
    export DISPLAY="${DISPLAY:-:0}"

    # Disable screen saver and power management
    xset s off    2>/dev/null || true
    xset -dpms    2>/dev/null || true
    xset s noblank 2>/dev/null || true

    # Hide mouse cursor after 1 second of inactivity
    unclutter -idle 1 -root &

    CHROMIUM_EXTRA_FLAGS=""
fi

# ------------------------------------------------------------------
# Wait for the OpenHamClock server to be ready (max 60 seconds)
# ------------------------------------------------------------------
HEALTH_URL="http://localhost:3000/api/health"
MAX_WAIT=60
WAITED=0
until curl -s "$HEALTH_URL" > /dev/null 2>&1; do
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        echo "ERROR: OpenHamClock server did not respond within ${MAX_WAIT}s."
        echo "Check the service: sudo systemctl status openhamclock"
        exit 1
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done
echo "Server ready after ${WAITED}s."

# ------------------------------------------------------------------
# Choose Chromium binary
# 'chromium' on Bookworm+, 'chromium-browser' on older images
# ------------------------------------------------------------------
if command -v chromium &> /dev/null; then
    CHROME_CMD="chromium"
else
    CHROME_CMD="chromium-browser"
fi

# ------------------------------------------------------------------
# Clear stale crash-recovery prompts from unclean shutdowns
# Prevents the "Chromium didn't shut down correctly" bar in kiosk mode
# ------------------------------------------------------------------
KIOSK_PROFILE="$HOME/.config/openhamclock-kiosk"
mkdir -p "$KIOSK_PROFILE"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true

# ------------------------------------------------------------------
# Launch Chromium in kiosk mode
# ------------------------------------------------------------------
trap 'pkill -f "chromium.*kiosk"; exit 0' SIGTERM SIGINT

# shellcheck disable=SC2086  # CHROMIUM_EXTRA_FLAGS is intentionally word-split
$CHROME_CMD \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --disable-component-update \
    --overscroll-history-navigation=0 \
    --disable-pinch \
    --password-store=basic \
    --user-data-dir="$HOME/.config/openhamclock-kiosk" \
    $CHROMIUM_EXTRA_FLAGS \
    http://localhost:3000 &

CHROME_PID=$!

echo "OpenHamClock kiosk running (PID: $CHROME_PID)"
echo "Exit methods:"
echo "  - Alt+F4        (close Chromium)"
echo "  - Ctrl+Alt+T    (open terminal, then: pkill -f kiosk)"
echo "  - SSH in and run: pkill -f kiosk.sh"

wait $CHROME_PID
EOF
    
    chmod +x "$INSTALL_DIR/kiosk.sh"
    
    # Create autostart entry
    cat > "$HOME/.config/autostart/openhamclock-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=OpenHamClock Kiosk
Exec=$INSTALL_DIR/kiosk.sh
Hidden=false
X-GNOME-Autostart-enabled=true
EOF
    
    # Configure boot for faster startup.
    # Bookworm and later (including Trixie) moved the config to /boot/firmware/config.txt.
    # Bullseye and older use /boot/config.txt.
    if [ -f /boot/firmware/config.txt ]; then
        BOOT_CONFIG=/boot/firmware/config.txt
    elif [ -f /boot/config.txt ]; then
        BOOT_CONFIG=/boot/config.txt
    else
        BOOT_CONFIG=""
    fi

    if [ -n "$BOOT_CONFIG" ]; then
        # Disable splash screen for faster boot
        if ! grep -q "disable_splash=1" "$BOOT_CONFIG"; then
            echo "disable_splash=1" | sudo tee -a "$BOOT_CONFIG" > /dev/null
        fi

        # Allocate more GPU memory for smooth rendering
        if ! grep -q "gpu_mem=" "$BOOT_CONFIG"; then
            echo "gpu_mem=128" | sudo tee -a "$BOOT_CONFIG" > /dev/null
        fi
    else
        echo -e "${YELLOW}⚠ Boot config not found — skipping gpu_mem and splash settings${NC}"
    fi
    
    echo -e "${GREEN}✓ Kiosk mode configured${NC}"
}

# Create helper scripts
create_scripts() {
    echo -e "${BLUE}>>> Creating helper scripts...${NC}"
    
    # Start script
    cat > "$INSTALL_DIR/start.sh" << EOF
#!/bin/bash
cd "$INSTALL_DIR"
node server.js
EOF
    chmod +x "$INSTALL_DIR/start.sh"
    
    # Stop script
    cat > "$INSTALL_DIR/stop.sh" << EOF
#!/bin/bash
sudo systemctl stop ${SERVICE_NAME}
pkill -f chromium 2>/dev/null || true
pkill -f unclutter 2>/dev/null || true
echo "OpenHamClock stopped"
EOF
    chmod +x "$INSTALL_DIR/stop.sh"
    
    # Restart script
    cat > "$INSTALL_DIR/restart.sh" << EOF
#!/bin/bash
sudo systemctl restart ${SERVICE_NAME}
echo "OpenHamClock restarted"
EOF
    chmod +x "$INSTALL_DIR/restart.sh"
    
    # Status script
    cat > "$INSTALL_DIR/status.sh" << EOF
#!/bin/bash
echo "=== OpenHamClock Status ==="
sudo systemctl status ${SERVICE_NAME} --no-pager
echo ""
echo "=== Server Health ==="
curl -s http://localhost:3000/api/health | python3 -m json.tool 2>/dev/null || echo "Server not responding"
EOF
    chmod +x "$INSTALL_DIR/status.sh"
    
    echo -e "${GREEN}✓ Helper scripts created${NC}"
}

# Print summary
print_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Installation Directory:${NC} $INSTALL_DIR"
    echo -e "  ${BLUE}Web Interface:${NC} http://localhost:3000"
    echo ""
    echo -e "  ${YELLOW}Helper Commands:${NC}"
    echo "    $INSTALL_DIR/scripts/update.sh - Update to latest version"
    echo "    $INSTALL_DIR/start.sh          - Start server manually"
    echo "    $INSTALL_DIR/stop.sh           - Stop everything"
    echo "    $INSTALL_DIR/restart.sh        - Restart server"
    echo "    $INSTALL_DIR/status.sh         - Check status"
    echo ""
    echo -e "  ${YELLOW}Service Commands:${NC}"
    echo "    sudo systemctl start ${SERVICE_NAME}"
    echo "    sudo systemctl stop ${SERVICE_NAME}"
    echo "    sudo systemctl status ${SERVICE_NAME}"
    echo "    sudo journalctl -u ${SERVICE_NAME} -f"
    echo ""
    
    if [ "$KIOSK_MODE" = true ]; then
        echo -e "  ${GREEN}Kiosk Mode:${NC} Enabled"
        echo "    OpenHamClock will auto-start on boot in fullscreen"
        echo ""
        echo -e "    ${YELLOW}Exit kiosk:${NC}"
        echo "      Alt+F4          Close Chromium"
        echo "      Ctrl+Alt+T      Open terminal (then: pkill -f kiosk)"
        echo "      SSH:            pkill -f kiosk.sh"
        echo ""
        echo -e "    ${YELLOW}Disable auto-start:${NC}"
        echo "      rm ~/.config/autostart/openhamclock-kiosk.desktop"
        echo ""
    fi
    
    echo -e "  ${BLUE}73 de OpenHamClock!${NC}"
    echo ""
    
    if [ "$KIOSK_MODE" = true ]; then
        read -p "Reboot now to start kiosk mode? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo reboot
        fi
    fi
}

# Main installation flow
main() {
    check_raspberry_pi
    update_system
    install_nodejs
    install_dependencies
    setup_repository
    create_service
    create_scripts
    
    if [ "$KIOSK_MODE" = true ]; then
        setup_kiosk
    fi
    
    print_summary
}

# Run main
main

#!/bin/bash
#
# OpenHamClock - Raspberry Pi Setup Script
# 
# This script configures a Raspberry Pi for kiosk mode operation
# Supports: Pi 3B, 3B+, 4, 5 (32-bit and 64-bit Raspberry Pi OS)
#
# Usage:
#   chmod +x setup-pi.sh
#   ./setup-pi.sh
#
# Options:
#   --kiosk     Enable kiosk mode (auto-start on boot)
#   --server    Install as a server (no GUI)
#   --help      Show help
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="$HOME/openhamclock"
SERVICE_NAME="openhamclock"
NODE_VERSION="20"

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
    sudo apt-get upgrade -y -qq
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
    
    # Install Node.js via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
}

# Install dependencies
install_dependencies() {
    echo -e "${BLUE}>>> Installing system dependencies...${NC}"
    
    PACKAGES="git"
    
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
    
    # Install npm dependencies
    npm install --include=dev
    
    # Download vendor assets (fonts, Leaflet) for self-hosting — no external CDN requests
    echo -e "${BLUE}>>> Downloading vendor assets for privacy...${NC}"
    bash scripts/vendor-download.sh || echo -e "${YELLOW}⚠ Vendor download failed — will fall back to CDN${NC}"
    
    # Build frontend for production
    npm run build
    
    # Make update script executable
    chmod +x scripts/update.sh 2>/dev/null || true
    
    echo -e "${GREEN}✓ OpenHamClock installed to $INSTALL_DIR${NC}"
}

# Create systemd service
create_service() {
    echo -e "${BLUE}>>> Creating systemd service...${NC}"
    
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=OpenHamClock Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
SuccessExitStatus=75
Environment=NODE_ENV=production
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
    
    # Disable screen blanking
    sudo raspi-config nonint do_blanking 1 2>/dev/null || true
    
    # Create autostart directory
    mkdir -p "$HOME/.config/autostart"
    
    # Create kiosk launcher script
    cat > "$INSTALL_DIR/kiosk.sh" << 'EOF'
#!/bin/bash
# OpenHamClock Kiosk Launcher

# Wait for desktop
sleep 5

# Disable screen saver and power management
xset s off
xset -dpms
xset s noblank

# Hide mouse cursor
unclutter -idle 1 -root &

# Wait for server to be ready
while ! curl -s http://localhost:3000/api/health > /dev/null; do
    sleep 1
done

# Launch Chromium in kiosk mode
# Use 'chromium' on newer Pi OS, 'chromium-browser' on older
if command -v chromium &> /dev/null; then
    CHROME_CMD="chromium"
else
    CHROME_CMD="chromium-browser"
fi

# Clean up any crash lock files from unclean shutdown
# Prevents "Chromium didn't shut down correctly" bar in kiosk mode
KIOSK_PROFILE="$HOME/.config/openhamclock-kiosk"
mkdir -p "$KIOSK_PROFILE"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$KIOSK_PROFILE/Default/Preferences" 2>/dev/null || true

# Trap Ctrl+Q to exit kiosk cleanly
trap 'pkill -f "chromium.*kiosk"; exit 0' SIGTERM SIGINT

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
    --user-data-dir=$HOME/.config/openhamclock-kiosk \
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
    
    # Configure boot for faster startup
    if [ -f /boot/config.txt ]; then
        # Disable splash screen for faster boot
        if ! grep -q "disable_splash=1" /boot/config.txt; then
            echo "disable_splash=1" | sudo tee -a /boot/config.txt > /dev/null
        fi
        
        # Allocate more GPU memory
        if ! grep -q "gpu_mem=" /boot/config.txt; then
            echo "gpu_mem=128" | sudo tee -a /boot/config.txt > /dev/null
        fi
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

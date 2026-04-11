#!/bin/bash
#
# OpenHamClock - Linux / macOS Setup Script
#
# ═══════════════════════════════════════════════════════════════════
# SUPPORTED PLATFORMS
# ═══════════════════════════════════════════════════════════════════
#
#   Linux (Ubuntu, Debian, Fedora, Arch, etc.)
#     All features supported including systemd service creation.
#
#   macOS (Homebrew-based Node.js)
#     Installs and builds OpenHamClock. Systemd is not available;
#     use `npm start` or the generated run.sh launcher.
#
#   For Raspberry Pi, use scripts/setup-pi.sh instead — it handles
#     kiosk mode, GPIO, display configuration, and Pi-specific setup.
#
# ═══════════════════════════════════════════════════════════════════
# PREREQUISITES
# ═══════════════════════════════════════════════════════════════════
#
#   • Node.js 18+ (22 LTS recommended)
#   • Git
#   • Internet access (npm, GitHub)
#   • sudo privileges (only needed with --service flag)
#
# ═══════════════════════════════════════════════════════════════════
# WHAT THIS SCRIPT DOES
# ═══════════════════════════════════════════════════════════════════
#
#   1. Verifies Node.js 18+ and Git are installed
#   2. Clones or updates the OpenHamClock repository
#   3. Runs npm install and npm run build
#   4. Downloads vendor assets for self-hosting (fonts, Leaflet)
#   5. Creates .env from .env.example (if absent)
#   6. Creates a run.sh launcher script
#   7. [--service] Creates and enables a systemd service (Linux only)
#
# ═══════════════════════════════════════════════════════════════════
# USAGE
# ═══════════════════════════════════════════════════════════════════
#
#   Quick install (pipe to bash):
#     curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-linux.sh | bash
#
#   With systemd service:
#     curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-linux.sh | bash -s -- --service
#
#   Manual:
#     chmod +x setup-linux.sh
#     ./setup-linux.sh                # install only
#     ./setup-linux.sh --service      # install + systemd service
#     ./setup-linux.sh --help         # show option summary
#
#   After installation, edit ~/openhamclock/.env to set your
#   CALLSIGN and LOCATOR before (re)starting.
#

set -e

# Colors
RED=$(tput setaf 1)
GREEN=$(tput setaf 2)
YELLOW=$(tput setaf 3; tput bold)
BLUE=$(tput setaf 4)
NC=$(tput sgr0) # No Color

# Configuration
INSTALL_DIR="$HOME/openhamclock"
SERVICE_NAME="openhamclock"
NODE_MIN_VERSION="18"

# Parse arguments
INSTALL_SERVICE=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --service) INSTALL_SERVICE=true ;;
        --help)
            echo "Usage: ./setup-linux.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --service   Create a systemd service for auto-start on boot (Linux only)"
            echo "  --help      Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Detect OS
IS_MACOS=false
IS_LINUX=false
HAS_SYSTEMD=false

detect_platform() {
    case "$(uname -s)" in
        Darwin)
            IS_MACOS=true
            echo -e "${GREEN}✓ Detected: macOS $(sw_vers -productVersion 2>/dev/null || echo '')${NC}"
            ;;
        Linux)
            IS_LINUX=true
            if [ -f /etc/os-release ]; then
                . /etc/os-release
                echo -e "${GREEN}✓ Detected: $PRETTY_NAME${NC}"
            else
                echo -e "${GREEN}✓ Detected: Linux${NC}"
            fi
            # Check for systemd
            if command -v systemctl &> /dev/null && [ -d /run/systemd/system ]; then
                HAS_SYSTEMD=true
            fi
            ;;
        *)
            echo -e "${YELLOW}⚠ Unknown OS: $(uname -s). Proceeding anyway...${NC}"
            IS_LINUX=true
            ;;
    esac
}

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
echo "║   Linux / macOS Setup Script                              ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js not found.${NC}"
        echo ""
        echo "  Install Node.js ${NODE_MIN_VERSION}+ using one of:"
        echo ""
        echo "    macOS:    brew install node"
        echo "    Ubuntu:   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
        echo "    Fedora:   sudo dnf install nodejs"
        echo "    Arch:     sudo pacman -S nodejs npm"
        echo ""
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
        echo -e "${RED}✗ Node.js ${NODE_MIN_VERSION}+ required. Current: $(node -v)${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"
}

# Check for Git
check_git() {
    if ! command -v git &> /dev/null; then
        echo -e "${RED}✗ Git not found. Please install Git first.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Git $(git --version | awk '{print $3}') detected${NC}"
}

# Clone or update repository, install deps, build
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

    # Install dependencies (including devDependencies for Vite build).
    # --ignore-scripts skips lifecycle hooks (postinstall, prepare, etc.) that can
    # fail on Linux — most notably electron-builder/electron-winstaller trying to
    # copy Windows-only binaries, and Husky git-hooks which are unnecessary here.
    # ELECTRON_SKIP_BINARY_DOWNLOAD=1 prevents the ~200 MB Electron binary download
    # since we only need Vite/React from devDependencies to build the frontend.
    echo -e "${BLUE}>>> Installing npm dependencies...${NC}"
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --include=dev --ignore-scripts

    # Download vendor assets (fonts, Leaflet) for self-hosting — no external CDN requests
    echo -e "${BLUE}>>> Downloading vendor assets for privacy...${NC}"
    bash scripts/vendor-download.sh || echo -e "${YELLOW}⚠ Vendor download failed — will fall back to CDN${NC}"

    # Build frontend for production
    echo -e "${BLUE}>>> Building frontend...${NC}"
    npm run build

    # Remove dev dependencies (electron, electron-builder, playwright, etc.) after
    # the build. These are only needed for the Vite build step and waste disk space.
    npm prune --omit=dev

    # Make update script executable
    chmod +x scripts/update.sh 2>/dev/null || true

    echo -e "${GREEN}✓ OpenHamClock built successfully${NC}"
}

# Create .env from template
setup_env() {
    cd "$INSTALL_DIR"

    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            # Switch to the production port (example defaults to 3001 for dev)
            if [ "$IS_MACOS" = true ]; then
                # macOS sed requires an extension argument with -i
                sed -i '' 's/^PORT=3001$/PORT=3000/' .env
            else
                sed -i 's/^PORT=3001$/PORT=3000/' .env
            fi
            echo -e "${YELLOW}⚠ A default .env file has been created at $INSTALL_DIR/.env${NC}"
            echo -e "${YELLOW}  Edit CALLSIGN and LOCATOR in .env to configure your station.${NC}"
        else
            echo -e "${YELLOW}⚠ No .env.example found — skipping .env creation${NC}"
        fi
    else
        echo -e "${GREEN}✓ Existing .env kept — not overwritten${NC}"
    fi
}

# Create launcher script
create_launcher() {
    cat > "$INSTALL_DIR/run.sh" << 'RUNEOF'
#!/bin/bash
# OpenHamClock Launcher
cd "$(dirname "$0")"

# Load .env if present
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

echo "Starting OpenHamClock..."
echo "Open http://localhost:${PORT} in your browser"
echo "Press Ctrl+C to stop"
node server.js
RUNEOF
    chmod +x "$INSTALL_DIR/run.sh"
    echo -e "${GREEN}✓ Launcher created at $INSTALL_DIR/run.sh${NC}"
}

# Create systemd service (Linux only)
create_service() {
    if [ "$IS_MACOS" = true ]; then
        echo -e "${YELLOW}⚠ systemd is not available on macOS.${NC}"
        echo -e "${YELLOW}  Use $INSTALL_DIR/run.sh to start manually, or create a launchd plist.${NC}"
        return
    fi

    if [ "$HAS_SYSTEMD" != true ]; then
        echo -e "${YELLOW}⚠ systemd not detected on this system.${NC}"
        echo -e "${YELLOW}  Use $INSTALL_DIR/run.sh to start manually.${NC}"
        return
    fi

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
    echo -e "${GREEN}  OpenHamClock will auto-start on boot${NC}"
}

# Print final summary
print_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}Configuration:${NC}"
    echo "    Edit $INSTALL_DIR/.env to set your CALLSIGN and LOCATOR"
    echo ""

    if [ "$INSTALL_SERVICE" = true ] && [ "$HAS_SYSTEMD" = true ] && [ "$IS_MACOS" != true ]; then
        echo -e "  ${BLUE}Service Commands:${NC}"
        echo "    sudo systemctl start ${SERVICE_NAME}      # Start"
        echo "    sudo systemctl stop ${SERVICE_NAME}       # Stop"
        echo "    sudo systemctl restart ${SERVICE_NAME}    # Restart (after .env changes)"
        echo "    sudo systemctl status ${SERVICE_NAME}     # Check status"
        echo "    sudo journalctl -u ${SERVICE_NAME} -f     # View logs"
        echo ""
        echo -e "  ${GREEN}Server is running at:${NC} http://localhost:3000"
    else
        echo -e "  ${BLUE}To start OpenHamClock:${NC}"
        echo ""
        echo "    $INSTALL_DIR/run.sh"
        echo ""
        echo "    Or: cd $INSTALL_DIR && npm start"
        echo ""
        echo -e "  ${BLUE}Then open:${NC} http://localhost:3000"

        if [ "$IS_LINUX" = true ] && [ "$HAS_SYSTEMD" = true ]; then
            echo ""
            echo -e "  ${YELLOW}Tip:${NC} Re-run with --service to auto-start on boot:"
            echo "    ./scripts/setup-linux.sh --service"
        fi
    fi

    echo ""
    echo -e "  ${BLUE}For Electron desktop app:${NC}"
    echo "    cd $INSTALL_DIR && npm run electron"
    echo ""
    echo -e "  ${BLUE}Update to latest version:${NC}"
    echo "    $INSTALL_DIR/scripts/update.sh"
    echo ""
    echo -e "  ${BLUE}73 de OpenHamClock!${NC}"
    echo ""
}

# Main
main() {
    detect_platform
    check_node
    check_git
    setup_repository
    setup_env
    create_launcher

    if [ "$INSTALL_SERVICE" = true ]; then
        create_service
    fi

    print_summary
}

main

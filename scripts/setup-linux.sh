#!/bin/bash
#
# OpenHamClock - Linux/macOS Setup Script
#
# Quick installation script for Linux and macOS systems
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup-linux.sh | bash
#
# Or manually:
#   chmod +x setup-linux.sh
#   ./setup-linux.sh
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="$HOME/openhamclock"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           OpenHamClock Installation Script                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}Node.js not found. Please install Node.js 18 or later:${NC}"
        echo ""
        echo "  macOS:    brew install node"
        echo "  Ubuntu:   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
        echo "  Fedora:   sudo dnf install nodejs"
        echo "  Arch:     sudo pacman -S nodejs npm"
        echo ""
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${YELLOW}Node.js version 18 or later required. Current: $(node -v)${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"
}

# Check for Git
check_git() {
    if ! command -v git &> /dev/null; then
        echo -e "${YELLOW}Git not found. Please install Git first.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Git detected${NC}"
}

# Clone or update repository
setup_repo() {
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
    
    # Install dependencies
    npm install --include=dev
    
    echo -e "${GREEN}✓ Installation complete${NC}"
}

# Create launcher script
create_launcher() {
    cat > "$INSTALL_DIR/run.sh" << EOF
#!/bin/bash
cd "$INSTALL_DIR"
echo "Starting OpenHamClock..."
echo "Open http://localhost:3000 in your browser"
node server.js
EOF
    chmod +x "$INSTALL_DIR/run.sh"
}

# Print instructions
print_instructions() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BLUE}To start OpenHamClock:${NC}"
    echo ""
    echo "    cd $INSTALL_DIR && npm start"
    echo ""
    echo "    Or use the launcher: $INSTALL_DIR/run.sh"
    echo ""
    echo -e "  ${BLUE}Then open:${NC} http://localhost:3000"
    echo ""
    echo -e "  ${BLUE}For Electron desktop app:${NC}"
    echo "    npm run electron"
    echo ""
    echo -e "  ${BLUE}73 de OpenHamClock!${NC}"
    echo ""
}

# Main
main() {
    check_node
    check_git
    setup_repo
    create_launcher
    print_instructions
}

main

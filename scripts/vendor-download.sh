#!/bin/bash
# ============================================================
# vendor-download.sh — Self-host external assets for privacy
# ============================================================
# Downloads Google Fonts, Leaflet CSS/JS, and other CDN assets
# so OpenHamClock makes ZERO external requests on page load.
#
# Run once after install:  bash scripts/vendor-download.sh
# The Pi setup script runs this automatically.
# ============================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$BASE_DIR/public/vendor"

echo "📦 Downloading vendor assets for self-hosting..."

mkdir -p "$VENDOR_DIR/fonts" "$VENDOR_DIR/leaflet"

# ── Leaflet 1.9.4 ──────────────────────────────────────────
echo "  → Leaflet 1.9.4..."
curl -sL "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" -o "$VENDOR_DIR/leaflet/leaflet.js"
curl -sL "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" -o "$VENDOR_DIR/leaflet/leaflet.css"

# Leaflet CSS references images/ for markers etc.
mkdir -p "$VENDOR_DIR/leaflet/images"
for img in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  curl -sL "https://unpkg.com/leaflet@1.9.4/dist/images/$img" -o "$VENDOR_DIR/leaflet/images/$img"
done

# ── Google Fonts (woff2) ────────────────────────────────────
# We fetch the CSS with a Chrome user-agent to get woff2 format
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0"
# Press Start 2P: the 8-Bit theme's pixel font; Antonio: the Trek theme's
# LCARS-style condensed face. Both OFL. Themes fall back to system fonts
# when the vendor bundle hasn't been refreshed.
FONT_URL="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Fira+Code:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@300;400;500;600;700&family=Press+Start+2P&family=Antonio:wght@400;500;600;700&display=swap"

echo "  → Google Fonts CSS..."
curl -sL -A "$UA" "$FONT_URL" -o /tmp/gfonts-raw.css

# Download each woff2 file and rewrite CSS to use local paths
echo "  → Downloading font files..."
COUNTER=0
cp /tmp/gfonts-raw.css "$VENDOR_DIR/fonts/fonts.css"

# Extract all woff2 URLs, download them, rewrite CSS
grep -oE 'https://fonts\.gstatic\.com/[^)]+' /tmp/gfonts-raw.css | sort -u | while read url; do
  COUNTER=$((COUNTER + 1))
  FILENAME="font-${COUNTER}.woff2"
  curl -sL "$url" -o "$VENDOR_DIR/fonts/$FILENAME"
  # Escape URL for sed (slashes)
  ESCAPED_URL=$(echo "$url" | sed 's/[\/&]/\\&/g')
  sed -i "s|$ESCAPED_URL|/vendor/fonts/$FILENAME|g" "$VENDOR_DIR/fonts/fonts.css"
done

# Clean up
rm -f /tmp/gfonts-raw.css

# ── Verify ──────────────────────────────────────────────────
echo ""
echo "✅ Vendor assets downloaded to $VENDOR_DIR/"
echo ""
ls -lh "$VENDOR_DIR/leaflet/leaflet.js" "$VENDOR_DIR/leaflet/leaflet.css" "$VENDOR_DIR/fonts/fonts.css" 2>/dev/null
FONT_COUNT=$(ls "$VENDOR_DIR/fonts/"*.woff2 2>/dev/null | wc -l)
echo "   $FONT_COUNT font files downloaded"
echo ""
echo "No external CDN requests will be made at runtime."

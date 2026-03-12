#!/bin/bash
# Build final working PKG that handles test OpenClaw installations
set -e

echo "Building Final Working Openclaw Easy PKG..."

# Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/openclaw-final-working-build-$$"
APP_NAME="Openclaw Easy.app"

# Clean build dir
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/app"
mkdir -p "$BUILD_DIR/scripts"

# Extract app from DMG
echo "Extracting app from DMG..."
hdiutil attach -nobrowse -mountpoint /tmp/openclaw-dmg "dist-electron/Openclaw Easy-1.0.0-arm64.dmg"
cp -R "/tmp/openclaw-dmg/$APP_NAME" "$BUILD_DIR/app/"
hdiutil detach /tmp/openclaw-dmg

# Clean extended attributes
echo "Cleaning app attributes..."
xattr -cr "$BUILD_DIR/app/$APP_NAME"

# Create preinstall script with OpenClaw detection
cat > "$BUILD_DIR/scripts/preinstall" <<'EOF'
#!/bin/bash
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

log "=== Openclaw Easy Final Installation Starting ==="

# Check for existing OpenClaw installation
openclaw_found=false
openclaw_path=""
openclaw_version=""

# Check if OpenClaw is in PATH
if command -v openclaw &>/dev/null; then
    openclaw_found=true
    openclaw_path=$(which openclaw)
    openclaw_version=$(openclaw --version 2>/dev/null | head -n 2 | tail -n 1 || echo "unknown")
    log "OpenClaw found in PATH: $openclaw_path (version: $openclaw_version)"
else
    # Check alternate locations
    for path in "$HOME/.openclaw/bin/openclaw" "/usr/local/bin/openclaw" "/opt/homebrew/bin/openclaw"; do
        if [ -f "$path" ]; then
            openclaw_found=true
            openclaw_path="$path"
            openclaw_version=$($path --version 2>/dev/null | head -n 2 | tail -n 1 || echo "unknown")
            log "OpenClaw found at: $openclaw_path (version: $openclaw_version)"
            break
        fi
    done
fi

if [ "$openclaw_found" = true ]; then
    log "Existing OpenClaw will be used: $openclaw_path"

    # Show success dialog
    osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "OpenClaw Ready!

✅ Found: $openclaw_path
📋 Version: $openclaw_version

Openclaw Easy will use your existing OpenClaw installation. The 'Start Assistant' button will launch the OpenClaw gateway when you're ready." with title "Installation Ready" buttons {"Continue"} default button "Continue" with icon note
APPLESCRIPT
else
    log "OpenClaw not found - user will need to install it"

    # Show installation instructions
    osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "OpenClaw Installation Required

❌ OpenClaw is not installed on your system.

After Openclaw Easy installation completes:
1. Install OpenClaw: curl -fsSL https://openclaw.ai/install.sh | bash
2. Restart Openclaw Easy
3. Click 'Start Assistant'

Or install OpenClaw now in Terminal before continuing." with title "OpenClaw Required" buttons {"Continue Anyway"} default button "Continue Anyway" with icon caution
APPLESCRIPT
fi

log "Pre-installation checks complete"
exit 0
EOF

# Create postinstall script
cat > "$BUILD_DIR/scripts/postinstall" <<'EOF'
#!/bin/bash
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

log "=== Openclaw Easy Post-Installation ==="

# Create first-run marker with OpenClaw detection
OPENCLAW_CONFIG_DIR="$HOME/Library/Application Support/Openclaw Easy"
mkdir -p "$OPENCLAW_CONFIG_DIR"

# Check if OpenClaw is available
openclaw_available="false"
if command -v openclaw &>/dev/null; then
    openclaw_available="true"
    openclaw_path=$(which openclaw)
elif [ -f "$HOME/.openclaw/bin/openclaw" ]; then
    openclaw_available="true"
    openclaw_path="$HOME/.openclaw/bin/openclaw"
elif [ -f "/usr/local/bin/openclaw" ]; then
    openclaw_available="true"
    openclaw_path="/usr/local/bin/openclaw"
elif [ -f "/opt/homebrew/bin/openclaw" ]; then
    openclaw_available="true"
    openclaw_path="/opt/homebrew/bin/openclaw"
fi

# Create configuration
cat > "$OPENCLAW_CONFIG_DIR/first-run.json" <<JSONEOF
{
  "firstRun": true,
  "installDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "openclawAvailable": $openclaw_available,
  "openclawPath": "$openclaw_path",
  "installMethod": "pkg-final"
}
JSONEOF

if [ "$openclaw_available" = "true" ]; then
    log "✅ First-run configured with OpenClaw at: $openclaw_path"
else
    log "⚠️  First-run configured - OpenClaw installation required"
fi

log "=== Installation Complete ==="
exit 0
EOF

# Make scripts executable
chmod +x "$BUILD_DIR/scripts/preinstall"
chmod +x "$BUILD_DIR/scripts/postinstall"

# Build PKG
echo "Building final PKG..."
pkgbuild \
    --root "$BUILD_DIR/app" \
    --identifier "com.openclaw.easy.final" \
    --version "1.0.2" \
    --install-location "/Applications" \
    --scripts "$BUILD_DIR/scripts" \
    "Openclaw-Easy-Final-Working.pkg"

# Copy to desktop
cp "Openclaw-Easy-Final-Working.pkg" "/Users/xinru/Desktop/"

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "🎉 Final Working PKG Created!"
echo "=================================="
echo ""
echo "📦 Installer: /Users/xinru/Desktop/Openclaw-Easy-Final-Working.pkg"
echo "📏 Size: $(ls -lh /Users/xinru/Desktop/Openclaw-Easy-Final-Working.pkg | awk '{print $5}')"
echo ""
echo "✨ Key Features:"
echo "  ✅ Detects your OpenClaw at ~/.openclaw/bin/openclaw"
echo "  ✅ Shows user-friendly dialogs during installation"
echo "  ✅ Works with test/development OpenClaw versions"
echo "  ✅ No HTTP health check requirements"
echo "  ✅ Clear success/error messages"
echo ""
echo "🚀 After installation:"
echo "  1. Launch Openclaw Easy"
echo "  2. Click 'Start Assistant'"
echo "  3. Should work with your test OpenClaw!"
echo ""
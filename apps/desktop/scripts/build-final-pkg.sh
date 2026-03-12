#!/bin/bash
# Final PKG builder - simple app install + OpenClaw detection
set -e

echo "Building Final Openclaw Easy PKG..."

# Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/openclaw-final-build-$$"
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

# Create simple preinstall script (just OpenClaw detection)
cat > "$BUILD_DIR/scripts/preinstall" <<'EOF'
#!/bin/bash
# Simple OpenClaw detection only
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Check for existing OpenClaw installation
if command -v openclaw &>/dev/null; then
    openclaw_path=$(which openclaw)
    openclaw_version=$(openclaw --version 2>/dev/null || echo "unknown")
    log "OpenClaw found at: $openclaw_path (version: $openclaw_version)"

    # Show info dialog
    osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "OpenClaw is already installed on your system.

Version: $openclaw_version
Location: $openclaw_path

Openclaw Easy will use your existing OpenClaw installation." with title "OpenClaw Detected" buttons {"OK"} default button "OK" with icon note
APPLESCRIPT
else
    # Check alternate locations
    for path in "$HOME/.openclaw/bin/openclaw" "/usr/local/bin/openclaw" "/opt/homebrew/bin/openclaw"; do
        if [ -f "$path" ]; then
            openclaw_version=$($path --version 2>/dev/null || echo "unknown")
            log "OpenClaw found at: $path (version: $openclaw_version)"

            osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "OpenClaw is installed but not in system PATH.

Version: $openclaw_version
Location: $path

Openclaw Easy will use your existing OpenClaw installation." with title "OpenClaw Detected" buttons {"OK"} default button "OK" with icon note
APPLESCRIPT
            exit 0
        fi
    done

    log "OpenClaw not found - will be installed on first app launch"
    osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "OpenClaw is not installed on your system.

Openclaw Easy will automatically install OpenClaw when you first launch the app.

This requires an internet connection." with title "OpenClaw Installation" buttons {"OK"} default button "OK" with icon note
APPLESCRIPT
fi

exit 0
EOF

# Create minimal postinstall script (just first-run marker)
cat > "$BUILD_DIR/scripts/postinstall" <<'EOF'
#!/bin/bash
# Create first-run marker only
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Create first-run marker
OPENCLAW_CONFIG_DIR="$HOME/Library/Application Support/Openclaw Easy"
mkdir -p "$OPENCLAW_CONFIG_DIR"

cat > "$OPENCLAW_CONFIG_DIR/first-run.json" <<JSONEOF
{
  "firstRun": true,
  "installDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "openclawRequired": true,
  "installMethod": "pkg"
}
JSONEOF

log "First-run marker created - OpenClaw will be installed on app launch"
exit 0
EOF

# Make scripts executable
chmod +x "$BUILD_DIR/scripts/preinstall"
chmod +x "$BUILD_DIR/scripts/postinstall"

# Build PKG with minimal scripts
echo "Building PKG..."
pkgbuild \
    --root "$BUILD_DIR/app" \
    --identifier "com.openclaw.easy" \
    --version "1.0.0" \
    --install-location "/Applications" \
    --scripts "$BUILD_DIR/scripts" \
    "Openclaw-Easy-Final.pkg"

# Copy to desktop
cp "Openclaw-Easy-Final.pkg" "/Users/xinru/Desktop/"

# Cleanup
rm -rf "$BUILD_DIR"

echo "✅ Final PKG created: /Users/xinru/Desktop/Openclaw-Easy-Final.pkg"
echo "📱 Features:"
echo "  ✅ Simple app installation (no interference)"
echo "  ✅ OpenClaw detection with user dialogs"
echo "  ✅ First-run marker for OpenClaw setup"
echo "  ✅ Works with existing or new OpenClaw installations"
echo "Size: $(ls -lh /Users/xinru/Desktop/Openclaw-Easy-Final.pkg | awk '{print $5}')"
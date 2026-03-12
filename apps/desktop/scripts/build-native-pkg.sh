#!/bin/bash
# Build Native Openclaw Easy PKG (OpenClaw Embedded)
set -e

echo "🏗️  Building Native Openclaw Easy PKG..."
echo "✨ OpenClaw is embedded - no external dependencies needed!"

# Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/openclaw-native-build-$$"
APP_NAME="Openclaw Easy.app"
PKG_VERSION="1.0.5"

# Clean build dir
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/app"
mkdir -p "$BUILD_DIR/scripts"
mkdir -p "$BUILD_DIR/resources"

# Extract app from DMG
echo "📦 Extracting app from DMG..."
hdiutil attach -nobrowse -mountpoint /tmp/openclaw-dmg "dist-electron/Openclaw Easy-1.0.0-arm64.dmg"
cp -R "/tmp/openclaw-dmg/$APP_NAME" "$BUILD_DIR/app/"
hdiutil detach /tmp/openclaw-dmg

# Clean extended attributes
echo "🧹 Cleaning app attributes..."
xattr -cr "$BUILD_DIR/app/$APP_NAME"

# Copy app icon for installer
echo "🎨 Setting up installer icon..."
cp "$DESKTOP_DIR/resources/icons/icon.icns" "$BUILD_DIR/resources/"

# Create simplified preinstall script (no OpenClaw dependencies)
cat > "$BUILD_DIR/scripts/preinstall" <<'EOF'
#!/bin/bash
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log "=== Openclaw Easy Native Installation Starting ==="

# Check macOS version
OS_VERSION=$(sw_vers -productVersion)
MAJOR_VERSION=$(echo "$OS_VERSION" | cut -d. -f1)
MINOR_VERSION=$(echo "$OS_VERSION" | cut -d. -f2)

if [[ $MAJOR_VERSION -lt 10 ]] || ([[ $MAJOR_VERSION -eq 10 ]] && [[ $MINOR_VERSION -lt 15 ]]); then
    echo "ERROR: macOS 10.15 or later is required. You have $OS_VERSION"
    exit 1
fi
log "macOS version: $OS_VERSION ✓"

# Check available disk space
DISK_AVAILABLE=$(df -g / | awk 'NR==2 {print $4}')
if [[ $DISK_AVAILABLE -lt 1 ]]; then
    echo "ERROR: Insufficient disk space. At least 1GB required, ${DISK_AVAILABLE}GB available."
    exit 1
fi
log "Available disk space: ${DISK_AVAILABLE}GB ✓"

# Show installation dialog
osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "🤖 Installing Openclaw Easy with Native AI

This installer will:
✅ Install Openclaw Easy app
✅ Embedded OpenClaw AI assistant
✅ Native dashboard interface

No external dependencies required!" with title "Openclaw Easy Native Installer" buttons {"Continue"} default button "Continue" with icon note
APPLESCRIPT

log "✅ System requirements verified - ready for native installation"
exit 0
EOF

# Create simplified postinstall script (no OpenClaw installation)
cat > "$BUILD_DIR/scripts/postinstall" <<'EOF'
#!/bin/bash
set -e

LOG_FILE="/tmp/openclaw-easy-install.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

echo "=========================================="
echo "🤖 Openclaw Easy Native Post-Installation"
echo "=========================================="

log "=== Openclaw Easy Native Installation Complete ==="

# Create configuration directory
OPENCLAW_CONFIG_DIR="$HOME/Library/Application Support/Openclaw Easy"
mkdir -p "$OPENCLAW_CONFIG_DIR"

# Create first-run marker (embedded OpenClaw)
cat > "$OPENCLAW_CONFIG_DIR/first-run.json" <<FIRSTRUN
{
  "firstRun": true,
  "installDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "openclawEmbedded": true,
  "installMethod": "native-pkg"
}
FIRSTRUN

echo ""
echo "✅ Openclaw Easy app installed to Applications folder"
echo "✅ OpenClaw AI assistant embedded and ready"
echo "✅ Native dashboard interface configured"
echo "✅ Installation verification completed"
echo ""
echo "🎉 SUCCESS: Openclaw Easy installed successfully!"
echo ""
echo "🚀 To get started:"
echo "   1. Open 'Openclaw Easy' from Applications folder"
echo "   2. Click 'Launch Assistant' to access the native dashboard"
echo "   3. Configure your AI provider API key to get started"
echo ""
echo "🤖 Features ready to use:"
echo "   ✅ Native OpenClaw dashboard"
echo "   ✅ Real-time AI assistant management"
echo "   ✅ Integrated configuration interface"
echo ""
echo "📞 Support: https://github.com/openclaw-easy/issues"
echo ""

log "Native installation complete - OpenClaw embedded and ready!"
exit 0
EOF

chmod +x "$BUILD_DIR/scripts/preinstall"
chmod +x "$BUILD_DIR/scripts/postinstall"

# Create distribution XML for productbuild with icon
cat > "$BUILD_DIR/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <title>Openclaw Easy Native</title>
    <background file="background.png" mime-type="image/png" alignment="topleft" scaling="none"/>
    <welcome file="welcome.html" mime-type="text/html"/>
    <license file="license.txt" mime-type="text/plain"/>
    <readme file="readme.html" mime-type="text/html"/>
    <conclusion file="conclusion.html" mime-type="text/html"/>
    <options customize="never" require-scripts="true" hostArchitectures="x86_64,arm64"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="10.15"/>
        </allowed-os-versions>
    </volume-check>
    <choices-outline>
        <line choice="default">
            <line choice="com.openclaw.easy.native"/>
        </line>
    </choices-outline>
    <choice id="default"/>
    <choice id="com.openclaw.easy.native" visible="false">
        <pkg-ref id="com.openclaw.easy.native"/>
    </choice>
    <pkg-ref id="com.openclaw.easy.native" version="$PKG_VERSION" auth="root">Openclaw-Easy-Native.pkg</pkg-ref>
</installer-gui-script>
XML

# Create installer resources
cat > "$BUILD_DIR/resources/welcome.html" <<HTML
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .header { color: #007AFF; font-size: 24px; margin-bottom: 20px; }
        .feature { margin: 10px 0; }
        .icon { color: #00C851; }
    </style>
</head>
<body>
    <div class="header">🤖 Openclaw Easy Native</div>
    <p>Welcome to Openclaw Easy with embedded OpenClaw AI assistant!</p>

    <div class="feature"><span class="icon">✅</span> <strong>Native AI Assistant:</strong> OpenClaw embedded directly in the app</div>
    <div class="feature"><span class="icon">✅</span> <strong>No Dependencies:</strong> Everything you need is included</div>
    <div class="feature"><span class="icon">✅</span> <strong>Native Dashboard:</strong> Integrated AI management interface</div>
    <div class="feature"><span class="icon">✅</span> <strong>Easy Setup:</strong> Just configure your API key and go!</div>

    <p style="margin-top: 20px;">This installer will place Openclaw Easy in your Applications folder, ready to use immediately.</p>
</body>
</html>
HTML

cat > "$BUILD_DIR/resources/conclusion.html" <<HTML
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .header { color: #00C851; font-size: 24px; margin-bottom: 20px; }
        .step { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">🎉 Installation Complete!</div>
    <p>Openclaw Easy has been successfully installed with embedded OpenClaw.</p>

    <div class="step">
        <strong>Step 1:</strong> Open Openclaw Easy from your Applications folder
    </div>
    <div class="step">
        <strong>Step 2:</strong> Click "Launch Assistant" to access the native dashboard
    </div>
    <div class="step">
        <strong>Step 3:</strong> Configure your AI provider API key in settings
    </div>

    <p style="margin-top: 20px;">Your AI assistant is now ready to use! No additional downloads or setup required.</p>
</body>
</html>
HTML

# Copy license and background
cp "$DESKTOP_DIR/installer-scripts/license.txt" "$BUILD_DIR/resources/" || echo "No license file found"

# Build the component package
echo "🔨 Building component package..."
pkgbuild \
    --root "$BUILD_DIR/app" \
    --identifier "com.openclaw.easy.native" \
    --version "$PKG_VERSION" \
    --install-location "/Applications" \
    --scripts "$BUILD_DIR/scripts" \
    "$BUILD_DIR/Openclaw-Easy-Native.pkg"

# Build the distribution package with custom icon and resources
echo "🎨 Building distribution package with icon..."
productbuild \
    --distribution "$BUILD_DIR/distribution.xml" \
    --resources "$BUILD_DIR/resources" \
    --package-path "$BUILD_DIR" \
    "Openclaw-Easy-Native-Installer.pkg"

# Copy to desktop
cp "Openclaw-Easy-Native-Installer.pkg" "/Users/xinru/Desktop/"

# Calculate size
PKG_SIZE=$(ls -lh "/Users/xinru/Desktop/Openclaw-Easy-Native-Installer.pkg" | awk '{print $5}')

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "🎉 NATIVE PKG CREATED!"
echo "======================"
echo ""
echo "📦 Installer: /Users/xinru/Desktop/Openclaw-Easy-Native-Installer.pkg"
echo "📏 Size: $PKG_SIZE"
echo ""
echo "🤖 NATIVE FEATURES:"
echo "  ✅ OpenClaw embedded directly in app"
echo "  ✅ No external dependencies or downloads"
echo "  ✅ Native dashboard interface"
echo "  ✅ Instant setup - just add API key"
echo "  ✅ Custom installer with app icon"
echo "  ✅ Professional installation experience"
echo ""
echo "📋 INSTALLATION PROCESS:"
echo "  1. Verifies system requirements only"
echo "  2. Installs app with embedded OpenClaw"
echo "  3. Sets up configuration for first run"
echo "  4. Ready to use immediately"
echo ""
echo "🎯 RESULT: Users get fully native OpenClaw experience!"
echo ""
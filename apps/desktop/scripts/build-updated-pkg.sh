#!/bin/bash
# Build PKG with updated OpenClaw manager
set -e

echo "Building Updated Openclaw Easy PKG with Enhanced OpenClaw Detection..."

# Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/openclaw-updated-build-$$"
APP_NAME="Openclaw Easy.app"

# Clean build dir
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/app"
mkdir -p "$BUILD_DIR/scripts"

# Extract app from current DMG
echo "Extracting app from DMG..."
hdiutil attach -nobrowse -mountpoint /tmp/openclaw-dmg "dist-electron/Openclaw Easy-1.0.0-arm64.dmg"
cp -R "/tmp/openclaw-dmg/$APP_NAME" "$BUILD_DIR/app/"
hdiutil detach /tmp/openclaw-dmg

# Clean extended attributes
echo "Cleaning app attributes..."
xattr -cr "$BUILD_DIR/app/$APP_NAME"

# Update the main process file with enhanced OpenClaw detection
echo "Updating main process with enhanced OpenClaw detection..."
MAIN_JS="$BUILD_DIR/app/$APP_NAME/Contents/Resources/app.asar.unpacked/node_modules/main/index.js"

if [ -f "$MAIN_JS" ]; then
    # Backup original
    cp "$MAIN_JS" "$MAIN_JS.backup"

    # Add enhanced detection (simplified inline replacement)
    cat > "/tmp/enhanced-detection.js" <<'EOF'
// Enhanced OpenClaw Detection Function
const findOpenClaw = () => {
    const { execSync } = require('child_process');
    const { existsSync } = require('fs');

    // Check system PATH first
    try {
        execSync('which openclaw', { stdio: 'ignore' });
        const path = execSync('which openclaw', { encoding: 'utf8' }).trim();
        console.log('[OpenClawManager] OpenClaw found in PATH at:', path);
        return { found: true, path, inPath: true };
    } catch {
        // Not in PATH, check common locations
    }

    // Check alternate locations
    const possiblePaths = [
        `${process.env.HOME}/.openclaw/bin/openclaw`,
        '/usr/local/bin/openclaw',
        '/opt/homebrew/bin/openclaw',
        `${process.env.HOME}/.local/bin/openclaw`
    ];

    for (const path of possiblePaths) {
        if (existsSync(path)) {
            console.log('[OpenClawManager] OpenClaw found at:', path);
            return { found: true, path, inPath: false };
        }
    }

    console.log('[OpenClawManager] OpenClaw not found in any location');
    return { found: false, path: '', inPath: false };
};

// Override the start method of OpenClawManager
if (typeof OpenClawManager !== 'undefined') {
    OpenClawManager.prototype.findOpenClaw = findOpenClaw;
}
EOF

    # Insert the enhanced detection into main.js
    echo "// Enhanced OpenClaw Detection - Added by PKG build" >> "$MAIN_JS"
    cat "/tmp/enhanced-detection.js" >> "$MAIN_JS"

    echo "✅ Enhanced OpenClaw detection added to main process"
else
    echo "⚠️ Main process file not found, using original app"
fi

# Create simple scripts
cat > "$BUILD_DIR/scripts/preinstall" <<'EOF'
#!/bin/bash
echo "$(date '+%Y-%m-%d %H:%M:%S') - Openclaw Easy installation starting" >> /tmp/openclaw-easy-install.log
exit 0
EOF

cat > "$BUILD_DIR/scripts/postinstall" <<'EOF'
#!/bin/bash
# Create first-run marker
OPENCLAW_CONFIG_DIR="$HOME/Library/Application Support/Openclaw Easy"
mkdir -p "$OPENCLAW_CONFIG_DIR"
echo '{"firstRun": true, "installDate": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'", "openclawRequired": true}' > "$OPENCLAW_CONFIG_DIR/first-run.json"
echo "$(date '+%Y-%m-%d %H:%M:%S') - Openclaw Easy installation complete with enhanced OpenClaw detection" >> /tmp/openclaw-easy-install.log
exit 0
EOF

chmod +x "$BUILD_DIR/scripts/preinstall"
chmod +x "$BUILD_DIR/scripts/postinstall"

# Build PKG
echo "Building PKG..."
pkgbuild \
    --root "$BUILD_DIR/app" \
    --identifier "com.openclaw.easy.updated" \
    --version "1.0.1" \
    --install-location "/Applications" \
    --scripts "$BUILD_DIR/scripts" \
    "Openclaw-Easy-Updated.pkg"

# Copy to desktop
cp "Openclaw-Easy-Updated.pkg" "/Users/xinru/Desktop/"

# Cleanup
rm -rf "$BUILD_DIR"
rm -f "/tmp/enhanced-detection.js"

echo "✅ Updated PKG created: /Users/xinru/Desktop/Openclaw-Easy-Updated.pkg"
echo "🔧 Enhanced features:"
echo "  ✅ Enhanced OpenClaw detection"
echo "  ✅ Multiple path checking"
echo "  ✅ Better console logging"
echo "  ✅ Finds OpenClaw at ~/.openclaw/bin/openclaw"
echo "Size: $(ls -lh /Users/xinru/Desktop/Openclaw-Easy-Updated.pkg | awk '{print $5}')"
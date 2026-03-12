#!/bin/bash
# Build Openclaw Easy PKG installer with new strategy
# Uses official OpenClaw installer - no dependency bundling needed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$DESKTOP_DIR/installer-build"
PKG_NAME="Openclaw-Easy-New-Strategy"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[✓]${NC} $1"
}

info() {
    echo -e "${BLUE}[i]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Clean and create build directory
setup_build_dir() {
    info "Setting up build directory..."

    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR/app"
    mkdir -p "$BUILD_DIR/scripts"

    log "Build directory created"
}

# Copy the built app
copy_app() {
    info "Copying Openclaw Easy app..."

    if [ -d "$DESKTOP_DIR/dist-electron/mac-arm64/Openclaw Easy.app" ]; then
        cp -R "$DESKTOP_DIR/dist-electron/mac-arm64/Openclaw Easy.app" "$BUILD_DIR/app/"
        log "ARM64 app copied"
    elif [ -d "$DESKTOP_DIR/dist-electron/mac/Openclaw Easy.app" ]; then
        cp -R "$DESKTOP_DIR/dist-electron/mac/Openclaw Easy.app" "$BUILD_DIR/app/"
        log "Universal app copied"
    else
        warning "No built app found. Run 'npm run build' first."
        exit 1
    fi
}

# Copy installation scripts
copy_scripts() {
    info "Copying installation scripts..."

    cp "$DESKTOP_DIR/installer-scripts/preinstall.sh" "$BUILD_DIR/scripts/preinstall"
    cp "$DESKTOP_DIR/installer-scripts/postinstall.sh" "$BUILD_DIR/scripts/postinstall"
    chmod +x "$BUILD_DIR/scripts/"*

    log "Installation scripts copied"
}

# Build PKG installer with proper payload
build_pkg() {
    info "Building PKG installer with app in payload..."

    cd "$BUILD_DIR"

    # Set permissions (ownership will be handled by installer)
    info "Setting permissions..."
    chmod -R 755 "app/Openclaw Easy.app"

    # Fix any extended attributes that might block installation
    xattr -cr "app/Openclaw Easy.app" 2>/dev/null || true

    # Build PKG with explicit ownership settings
    pkgbuild \
        --root app \
        --identifier com.openclaw-easy \
        --version 1.0.0 \
        --install-location "/Applications" \
        --scripts scripts \
        --ownership recommended \
        "${PKG_NAME}.pkg"

    log "PKG installer built: ${PKG_NAME}.pkg"
}

# Copy to desktop for testing
copy_to_desktop() {
    info "Copying installer to desktop..."

    cp "$BUILD_DIR/${PKG_NAME}.pkg" "/Users/xinru/Desktop/"

    log "Installer copied to desktop"
}

# Show summary
show_summary() {
    echo ""
    echo "=========================================="
    echo -e "${GREEN}New PKG Installer Built Successfully!${NC}"
    echo "=========================================="
    echo ""
    echo "Installer: ${PKG_NAME}.pkg"
    echo "Location: /Users/xinru/Desktop/"

    if [ -f "/Users/xinru/Desktop/${PKG_NAME}.pkg" ]; then
        SIZE=$(ls -lh "/Users/xinru/Desktop/${PKG_NAME}.pkg" | awk '{print $5}')
        echo "Size: $SIZE"
    fi

    echo ""
    echo "Key Features:"
    echo "✅ Uses official OpenClaw installer"
    echo "✅ Internet-based dependency download"
    echo "✅ Always gets latest OpenClaw version"
    echo "✅ Smaller package size"
    echo "✅ Official OpenClaw support"
    echo ""
    echo "Installation Requirements:"
    echo "• Internet connection"
    echo "• macOS 10.15+"
    echo "• 1GB free space"
    echo ""
}

# Main build process
main() {
    info "=== Building Openclaw Easy New Strategy PKG ==="

    setup_build_dir
    copy_app
    copy_scripts
    build_pkg
    copy_to_desktop
    show_summary

    log "=== Build Complete ==="
}

# Run main function
main "$@"
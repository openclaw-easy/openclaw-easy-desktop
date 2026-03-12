#!/bin/bash
# Simple PKG builder that actually works
set -e

echo "Building Simple Openclaw Easy PKG..."

# Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="/tmp/openclaw-simple-build-$$"
APP_NAME="Openclaw Easy.app"

# Clean build dir
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Extract app from DMG
echo "Extracting app from DMG..."
hdiutil attach -nobrowse -mountpoint /tmp/openclaw-dmg "dist-electron/Openclaw Easy-1.0.0-arm64.dmg"
cp -R "/tmp/openclaw-dmg/$APP_NAME" "$BUILD_DIR/"
hdiutil detach /tmp/openclaw-dmg

# Clean extended attributes
echo "Cleaning app attributes..."
xattr -cr "$BUILD_DIR/$APP_NAME"

# Build simple PKG without scripts (just the app)
echo "Building PKG..."
pkgbuild \
    --root "$BUILD_DIR" \
    --identifier "com.openclaw.easy" \
    --version "1.0.0" \
    --install-location "/Applications" \
    "Openclaw-Easy-Simple.pkg"

# Copy to desktop
cp "Openclaw-Easy-Simple.pkg" "$HOME/Desktop/"

# Cleanup
rm -rf "$BUILD_DIR"

echo "✅ Simple PKG created: $HOME/Desktop/Openclaw-Easy-Simple.pkg"
echo "Size: $(ls -lh $HOME/Desktop/Openclaw-Easy-Simple.pkg | awk '{print $5}')"
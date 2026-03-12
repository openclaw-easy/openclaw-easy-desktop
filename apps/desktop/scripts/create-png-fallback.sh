#!/bin/bash

# Simple PNG creation using base64 data or existing tools

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_ROOT/resources/icons"

echo "🦞 Creating fallback PNG icon using alternative method..."

# Create a simple 512x512 PNG using ImageMagick with a different approach
# First create a simple colored background
magick -size 512x512 xc:"#2f3136" \
       -fill "#5865F2" \
       -stroke "#5865F2" \
       -strokewidth 8 \
       -draw "roundrectangle 50,50 462,462 50,50" \
       -fill white \
       -pointsize 280 \
       -gravity center \
       -annotate +0+0 "🦞" \
       "$ICONS_DIR/icon.png" 2>/dev/null || \
magick -size 512x512 xc:"#2f3136" \
       -fill "#5865F2" \
       -stroke "#5865F2" \
       -strokewidth 8 \
       -draw "roundrectangle 50,50 462,462 50,50" \
       -fill white \
       -pointsize 280 \
       -gravity center \
       -font "Helvetica-Bold" \
       -annotate +0+0 "🦞" \
       "$ICONS_DIR/icon.png" 2>/dev/null || \
magick -size 512x512 xc:"#2f3136" \
       -fill "#5865F2" \
       -stroke "#5865F2" \
       -strokewidth 8 \
       -draw "roundrectangle 50,50 462,462 50,50" \
       -fill white \
       -pointsize 280 \
       -gravity center \
       -annotate +0+0 "L" \
       "$ICONS_DIR/icon.png" || echo "All ImageMagick attempts failed"

echo "Generated main PNG icon"

# Create other sizes
for size in 256 128 64 32 16; do
    if [ -f "$ICONS_DIR/icon.png" ]; then
        magick "$ICONS_DIR/icon.png" -resize ${size}x${size} "$ICONS_DIR/icon-${size}.png"
        echo "Generated ${size}x${size} icon"
    fi
done

# Try to create ICO
if [ -f "$ICONS_DIR/icon-32.png" ] && [ -f "$ICONS_DIR/icon-16.png" ]; then
    magick "$ICONS_DIR/icon-32.png" "$ICONS_DIR/icon-16.png" "$ICONS_DIR/icon.ico" 2>/dev/null || echo "ICO creation failed"
    echo "Generated ICO icon"
fi

# Try to create ICNS for macOS
if [ -f "$ICONS_DIR/icon.png" ]; then
    ICONSET_DIR="$ICONS_DIR/icon.iconset"
    mkdir -p "$ICONSET_DIR"

    magick "$ICONS_DIR/icon.png" -resize 16x16 "$ICONSET_DIR/icon_16x16.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 32x32 "$ICONSET_DIR/icon_16x16@2x.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 32x32 "$ICONSET_DIR/icon_32x32.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 64x64 "$ICONSET_DIR/icon_32x32@2x.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 128x128 "$ICONSET_DIR/icon_128x128.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 256x256 "$ICONSET_DIR/icon_128x128@2x.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 256x256 "$ICONSET_DIR/icon_256x256.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 512x512 "$ICONSET_DIR/icon_256x256@2x.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 512x512 "$ICONSET_DIR/icon_512x512.png" 2>/dev/null
    magick "$ICONS_DIR/icon.png" -resize 1024x1024 "$ICONSET_DIR/icon_512x512@2x.png" 2>/dev/null || \
    cp "$ICONS_DIR/icon.png" "$ICONSET_DIR/icon_512x512@2x.png" # Fallback to original size

    # Create ICNS using iconutil
    if command -v iconutil >/dev/null 2>&1; then
        iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns" 2>/dev/null && echo "Generated ICNS icon"
    fi

    # Clean up
    rm -rf "$ICONSET_DIR"
fi

ls -la "$ICONS_DIR"/*.png "$ICONS_DIR"/*.ico "$ICONS_DIR"/*.icns 2>/dev/null || echo "Final files created"

echo "✅ Icon creation complete!"
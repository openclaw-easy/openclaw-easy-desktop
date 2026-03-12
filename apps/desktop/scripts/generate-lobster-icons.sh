#!/bin/bash

# Generate Lobster Icons Script
# This script creates app icons using the lobster emoji for consistent OpenClaw branding

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_ROOT/resources/icons"

echo "🦞 Generating OpenClaw Lobster Icons..."
echo "Project root: $PROJECT_ROOT"
echo "Icons directory: $ICONS_DIR"

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

# Check if ImageMagick is available
if ! command -v convert &> /dev/null; then
    echo "⚠️  ImageMagick not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install imagemagick
    else
        echo "❌ Homebrew not found. Please install ImageMagick manually:"
        echo "   brew install imagemagick"
        echo "   or visit: https://imagemagick.org/script/download.php"
        exit 1
    fi
fi

# Function to create a lobster icon with background
create_lobster_icon() {
    local size=$1
    local output_file=$2
    local bg_color=${3:-"#2f3136"}  # Discord dark theme background

    echo "Creating ${size}x${size} icon: $output_file"

    # Create a base image with dark background and lobster emoji
    convert -size ${size}x${size} xc:"$bg_color" \
            -gravity center \
            -font "Apple Color Emoji" \
            -pointsize $((size * 60 / 100)) \
            -fill white \
            -annotate +0+0 "🦞" \
            "$output_file"
}

# Generate PNG icon (used for Linux and as base)
echo "📱 Generating PNG icon..."
create_lobster_icon 512 "$ICONS_DIR/icon.png"

# Create smaller PNG variants for different uses
create_lobster_icon 256 "$ICONS_DIR/icon-256.png"
create_lobster_icon 128 "$ICONS_DIR/icon-128.png"
create_lobster_icon 64 "$ICONS_DIR/icon-64.png"
create_lobster_icon 32 "$ICONS_DIR/icon-32.png"
create_lobster_icon 16 "$ICONS_DIR/icon-16.png"

# Generate ICO file for Windows
echo "🪟 Generating ICO icon for Windows..."
if command -v magick &> /dev/null; then
    magick "$ICONS_DIR/icon.png" \
           "$ICONS_DIR/icon-256.png" \
           "$ICONS_DIR/icon-128.png" \
           "$ICONS_DIR/icon-64.png" \
           "$ICONS_DIR/icon-32.png" \
           "$ICONS_DIR/icon-16.png" \
           "$ICONS_DIR/icon.ico"
else
    convert "$ICONS_DIR/icon.png" \
            "$ICONS_DIR/icon-256.png" \
            "$ICONS_DIR/icon-128.png" \
            "$ICONS_DIR/icon-64.png" \
            "$ICONS_DIR/icon-32.png" \
            "$ICONS_DIR/icon-16.png" \
            "$ICONS_DIR/icon.ico"
fi

# Generate ICNS file for macOS
echo "🍎 Generating ICNS icon for macOS..."

# Create iconset directory
ICONSET_DIR="$ICONS_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

# Generate all required sizes for macOS iconset
declare -A mac_sizes=(
    ["icon_16x16.png"]=16
    ["icon_16x16@2x.png"]=32
    ["icon_32x32.png"]=32
    ["icon_32x32@2x.png"]=64
    ["icon_128x128.png"]=128
    ["icon_128x128@2x.png"]=256
    ["icon_256x256.png"]=256
    ["icon_256x256@2x.png"]=512
    ["icon_512x512.png"]=512
    ["icon_512x512@2x.png"]=1024
)

for filename in "${!mac_sizes[@]}"; do
    size=${mac_sizes[$filename]}
    echo "  Creating $filename (${size}x${size})"
    create_lobster_icon $size "$ICONSET_DIR/$filename"
done

# Convert iconset to icns
if command -v iconutil &> /dev/null; then
    iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
    echo "✅ Generated icon.icns using iconutil"
else
    echo "⚠️  iconutil not found (macOS only). Skipping ICNS generation."
    echo "   You may need to generate icon.icns manually or run this on macOS."
fi

# Clean up iconset directory
rm -rf "$ICONSET_DIR"

# Generate SVG icon for scalability
echo "🎨 Generating SVG icon..."
cat > "$ICONS_DIR/icon.svg" << 'EOF'
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #2f3136; }
      .lobster-text {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
        font-size: 300px;
        text-anchor: middle;
        dominant-baseline: central;
      }
    </style>
  </defs>

  <!-- Background circle -->
  <circle cx="256" cy="256" r="240" class="bg" stroke="#5865F2" stroke-width="8"/>

  <!-- Lobster emoji -->
  <text x="256" y="256" class="lobster-text">🦞</text>
</svg>
EOF

echo ""
echo "✅ OpenClaw Lobster Icons Generated Successfully!"
echo ""
echo "📁 Generated files:"
echo "   - icon.png (512x512) - Main icon"
echo "   - icon.ico - Windows icon"
echo "   - icon.icns - macOS icon"
echo "   - icon.svg - Scalable vector icon"
echo "   - Various PNG sizes for different uses"
echo ""
echo "🎯 These icons will be used in:"
echo "   - Desktop app window/taskbar"
echo "   - DMG installer (macOS)"
echo "   - NSIS installer (Windows)"
echo "   - AppImage (Linux)"
echo ""
echo "🦞 OpenClaw branding is now consistent across all platforms!"

# Make sure the generated files have correct permissions
chmod 644 "$ICONS_DIR"/*.png "$ICONS_DIR"/*.ico "$ICONS_DIR"/*.svg 2>/dev/null || true
[ -f "$ICONS_DIR/icon.icns" ] && chmod 644 "$ICONS_DIR/icon.icns"

echo "✅ Icon generation complete!"
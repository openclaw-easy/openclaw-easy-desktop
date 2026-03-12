#!/bin/bash

# Create macOS-conforming app icons with pre-rendered squircle shape.
#
# macOS Big Sur+ does NOT auto-mask .icns icons for apps. If you provide
# a full-bleed square, macOS shrinks it and places it inside a white
# rounded-rectangle frame. To avoid this, the icon must include the
# squircle shape with transparent padding baked in.
#
# CRITICAL: All PNGs must be 8-bit RGBA (color-type=6) with hasAlpha=yes.
# If macOS detects no alpha channel or 16-bit depth, it treats the icon
# as non-conforming and adds an ugly white frame.
#
# Apple icon grid (1024x1024 canvas):
#   - Icon body: ~864x864 centered (80px padding each side)
#   - Corner radius: ~185px (22.4% of body)
#
# Windows .ico stays full-bleed (Windows doesn't use squircle).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_ROOT/resources/icons"

cd "$ICONS_DIR"

# Force 8-bit RGBA output for all PNGs
RGBA_OPTS="-depth 8 -define png:color-type=6"

echo "🦞 Creating macOS-conforming squircle lobster icons..."

# ── Step 1: Create 1024x1024 macOS icon ──────────────────────────────

# Create gradient with squircle alpha mask in one pass.
# CopyOpacity takes the mask's luminance as the output alpha channel,
# giving us transparent corners (unlike DstIn which can strip alpha).
magick -size 1024x1024 gradient:'#C0D8FE'-'#5B88FE' \
  \( -size 1024x1024 xc:none -fill white \
     -draw "roundrectangle 80,80 944,944 185,185" -alpha extract \) \
  -compose CopyOpacity -composite \
  $RGBA_OPTS _bg_1024.png

# Composite lobster emoji onto gradient squircle
if [ -f lobster-emoji.png ]; then
  magick _bg_1024.png \
    \( lobster-emoji.png -resize 620x620 \) -gravity center -composite \
    $RGBA_OPTS icon_1024.png
else
  cp _bg_1024.png icon_1024.png
fi
echo "Created 1024x1024 macOS icon"

# ── Step 2: Generate macOS sizes ─────────────────────────────────────

magick icon_1024.png -resize 512x512 $RGBA_OPTS icon.png
for size in 256 128 64 32 16; do
  magick icon_1024.png -resize ${size}x${size} $RGBA_OPTS icon-${size}.png
  echo "Created ${size}x${size} macOS icon"
done

# ── Step 3: Build .icns ──────────────────────────────────────────────

mkdir -p icon.iconset
cp icon-16.png  icon.iconset/icon_16x16.png
cp icon-32.png  icon.iconset/icon_16x16@2x.png
cp icon-32.png  icon.iconset/icon_32x32.png
cp icon-64.png  icon.iconset/icon_32x32@2x.png
cp icon-128.png icon.iconset/icon_128x128.png
cp icon-256.png icon.iconset/icon_128x128@2x.png
cp icon-256.png icon.iconset/icon_256x256.png
cp icon.png     icon.iconset/icon_256x256@2x.png
cp icon.png     icon.iconset/icon_512x512.png
cp icon_1024.png icon.iconset/icon_512x512@2x.png

iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
echo "Created macOS ICNS"

# ── Step 4: Build Windows .ico (full-bleed, no squircle) ─────────────

for size in 256 128 64 32 16; do
  magick -size ${size}x${size} gradient:'#C0D8FE'-'#5B88FE' _win_bg_${size}.png
  if [ -f lobster-emoji.png ]; then
    lobster_size=$((size * 74 / 100))
    magick _win_bg_${size}.png \
      \( lobster-emoji.png -resize ${lobster_size}x${lobster_size} \) -gravity center -composite \
      _win_${size}.png
  else
    magick _win_bg_${size}.png icon-${size}.png -composite _win_${size}.png
  fi
done

magick _win_16.png _win_32.png _win_64.png _win_128.png _win_256.png icon.ico
echo "Created Windows ICO (full-bleed)"

# ── Cleanup ──────────────────────────────────────────────────────────

rm -f _bg_*.png _win_*.png _win_bg_*.png icon_1024.png

echo "✅ macOS + Windows icons created successfully!"
ls -la icon*.png icon.ico icon.icns | head -10

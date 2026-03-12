#!/usr/bin/env python3
"""
Fallback lobster icon generator using PIL/Pillow
Creates proper PNG icons with lobster emoji for OpenClaw branding
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont
import subprocess

def create_lobster_icon(size, output_path, bg_color="#2f3136"):
    """Create a lobster icon using PIL"""
    try:
        # Create base image with dark background
        img = Image.new('RGBA', (size, size), bg_color)
        draw = ImageDraw.Draw(img)

        # Try to find a system emoji font
        emoji_fonts = [
            "/System/Library/Fonts/Apple Color Emoji.ttc",
            "/System/Library/Fonts/Helvetica.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "arial.ttf"
        ]

        font = None
        font_size = int(size * 0.6)  # 60% of icon size

        for font_path in emoji_fonts:
            if os.path.exists(font_path):
                try:
                    font = ImageFont.truetype(font_path, font_size)
                    break
                except:
                    continue

        if font is None:
            font = ImageFont.load_default()

        # Calculate position to center the emoji
        emoji = "🦞"
        text_bbox = draw.textbbox((0, 0), emoji, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - text_bbox[1]  # Adjust for baseline

        # Draw the lobster emoji
        draw.text((x, y), emoji, fill="white", font=font)

        # Add a subtle circular border
        border_width = max(2, size // 64)
        draw.ellipse([border_width//2, border_width//2, size-border_width//2, size-border_width//2],
                    outline="#5865F2", width=border_width)

        # Save the image
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        img.save(output_path, 'PNG')
        print(f"Created {size}x{size} icon: {output_path}")
        return True

    except Exception as e:
        print(f"Error creating {output_path}: {e}")
        return False

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, "resources", "icons")

    print("🦞 Creating OpenClaw Lobster Icons (Fallback)...")
    print(f"Icons directory: {icons_dir}")

    # Create PNG icons in various sizes
    sizes = [512, 256, 128, 64, 32, 16]
    success_count = 0

    for size in sizes:
        if size == 512:
            output_path = os.path.join(icons_dir, "icon.png")
        else:
            output_path = os.path.join(icons_dir, f"icon-{size}.png")

        if create_lobster_icon(size, output_path):
            success_count += 1

    print(f"✅ Created {success_count}/{len(sizes)} PNG icons")

    # Create ICO file for Windows
    try:
        ico_files = [os.path.join(icons_dir, f"icon-{s}.png") for s in [32, 64, 128, 256]]
        ico_files = [f for f in ico_files if os.path.exists(f)]

        if ico_files:
            ico_path = os.path.join(icons_dir, "icon.ico")
            # Use PIL to create ICO
            images = []
            for ico_file in ico_files:
                img = Image.open(ico_file)
                images.append(img)
            images[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in images])
            print("🪟 Created ICO file for Windows")
    except Exception as e:
        print(f"⚠️ Could not create ICO: {e}")

    # Create macOS ICNS using iconutil if available
    try:
        iconset_dir = os.path.join(icons_dir, "icon.iconset")
        os.makedirs(iconset_dir, exist_ok=True)

        # macOS iconset requires specific naming
        mac_mappings = {
            "icon_16x16.png": 16,
            "icon_16x16@2x.png": 32,
            "icon_32x32.png": 32,
            "icon_32x32@2x.png": 64,
            "icon_128x128.png": 128,
            "icon_128x128@2x.png": 256,
            "icon_256x256.png": 256,
            "icon_256x256@2x.png": 512,
            "icon_512x512.png": 512,
            "icon_512x512@2x.png": 1024
        }

        for filename, size in mac_mappings.items():
            iconset_path = os.path.join(iconset_dir, filename)
            if size <= 512:  # We only have up to 512px
                create_lobster_icon(size, iconset_path)

        # Convert to ICNS using iconutil
        icns_path = os.path.join(icons_dir, "icon.icns")
        result = subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', icns_path],
                              capture_output=True, text=True)

        if result.returncode == 0:
            print("🍎 Created ICNS file for macOS")
            # Clean up iconset directory
            import shutil
            shutil.rmtree(iconset_dir)
        else:
            print(f"⚠️ iconutil failed: {result.stderr}")

    except FileNotFoundError:
        print("⚠️ iconutil not found (macOS only)")
    except Exception as e:
        print(f"⚠️ Could not create ICNS: {e}")

    # Create SVG
    svg_content = '''<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #2f3136; }
      .lobster-text {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
        font-size: 300px;
        text-anchor: middle;
        dominant-baseline: central;
        fill: white;
      }
    </style>
  </defs>

  <!-- Background circle -->
  <circle cx="256" cy="256" r="240" class="bg" stroke="#5865F2" stroke-width="8"/>

  <!-- Lobster emoji -->
  <text x="256" y="256" class="lobster-text">🦞</text>
</svg>'''

    svg_path = os.path.join(icons_dir, "icon.svg")
    with open(svg_path, 'w') as f:
        f.write(svg_content)
    print("🎨 Created SVG icon")

    print("\n✅ OpenClaw Lobster Icons Generated Successfully!")
    print("🦞 Ready to use for desktop app branding!")

if __name__ == "__main__":
    main()
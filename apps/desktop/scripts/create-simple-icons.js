#!/usr/bin/env node
/**
 * Simple icon creator using Node.js and HTML Canvas API
 * Creates lobster-themed icons for OpenClaw branding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a simple SVG-based approach first
function createSVGIcon(size, outputPath, bgColor = "#2f3136") {
    const svgContent = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: ${bgColor}; }
      .border { stroke: #5865F2; stroke-width: ${Math.max(2, size/64)}; fill: none; }
      .lobster {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Helvetica", sans-serif;
        font-size: ${size * 0.6}px;
        text-anchor: middle;
        dominant-baseline: central;
        fill: white;
      }
    </style>
  </defs>

  <!-- Background -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="${size * 0.1}" class="bg"/>

  <!-- Border -->
  <rect x="${size/64}" y="${size/64}" width="${size - size/32}" height="${size - size/32}" rx="${size * 0.1}" class="border"/>

  <!-- Lobster emoji -->
  <text x="${size/2}" y="${size/2}" class="lobster">🦞</text>
</svg>`;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, svgContent);
    console.log(`Created ${size}x${size} SVG: ${outputPath}`);
    return true;
}

function createLobsterIconSet() {
    const scriptDir = __dirname;
    const projectRoot = path.dirname(scriptDir);
    const iconsDir = path.join(projectRoot, 'resources', 'icons');

    console.log('🦞 Creating OpenClaw Lobster Icon Set...');
    console.log(`Icons directory: ${iconsDir}`);

    // Ensure icons directory exists
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }

    // Create main SVG icon
    const mainSvgPath = path.join(iconsDir, 'icon.svg');
    createSVGIcon(512, mainSvgPath);

    // Create different sized SVGs (we can convert these to PNG later if needed)
    const sizes = [512, 256, 128, 64, 32, 16];

    sizes.forEach(size => {
        const filename = size === 512 ? 'icon.svg' : `icon-${size}.svg`;
        const svgPath = path.join(iconsDir, filename);
        createSVGIcon(size, svgPath);
    });

    // Create a basic ICO structure (simplified)
    console.log('🎯 SVG icons created successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Use these SVG files as app icons');
    console.log('2. Convert to PNG/ICO/ICNS using online tools or ImageMagick');
    console.log('3. Update Electron configuration to use the new icons');
    console.log('');
    console.log('🦞 OpenClaw branding is ready!');

    return true;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    createLobsterIconSet();
}

export { createLobsterIconSet, createSVGIcon };
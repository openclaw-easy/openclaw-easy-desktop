#!/bin/bash
# Prepare installer-resources/bun and installer-resources/openclaw before building the DMG.
# Run this once (after building openclaw: pnpm run build at repo root) before building the app.
#
# Output layout (used by electron-builder extraResources):
#   installer-resources/bun/bun-arm64                     ← Bun binary for Apple Silicon
#   installer-resources/bun/bun-x64                       ← Bun binary for Intel
#   installer-resources/openclaw/dist/                    ← compiled OpenClaw JS
#   installer-resources/openclaw/extensions/              ← bundled channel plugins (whatsapp, telegram, etc.)
#   installer-resources/openclaw/skills/                  ← bundled agent skills
#   installer-resources/openclaw/docs/reference/templates ← workspace templates (AGENTS.md etc.)
#   installer-resources/openclaw/openclaw.mjs
#   installer-resources/openclaw/package.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
# OpenClaw source lives in the openclaw/ subdirectory at repo root
# apps/desktop → apps → repo root → openclaw/
WORKSPACE_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)/openclaw"

BUN_VERSION="1.3.9"   # pin to a known-good release
BUN_DIR="$DESKTOP_DIR/installer-resources/bun"
OPENCLAW_DIR="$DESKTOP_DIR/installer-resources/openclaw"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

echo "Workspace: $WORKSPACE_DIR"

# ── bun binaries ─────────────────────────────────────────────────────────────
mkdir -p "$BUN_DIR"

download_bun() {
  local arch="$1"        # aarch64 | x64
  local out_name="$2"    # bun-arm64 | bun-x64
  local out_path="$BUN_DIR/$out_name"

  if [ -f "$out_path" ]; then
    log "bun $arch already downloaded"
    return
  fi

  info "Downloading bun $BUN_VERSION for $arch..."
  local url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-${arch}.zip"
  local tmp_zip="/tmp/bun-darwin-${arch}.zip"

  curl -L --progress-bar -o "$tmp_zip" "$url"
  unzip -p "$tmp_zip" "bun-darwin-${arch}/bun" > "$out_path"
  chmod +x "$out_path"
  rm -f "$tmp_zip"

  log "bun $arch downloaded → installer-resources/bun/$out_name ($(du -sh "$out_path" | cut -f1))"
}

download_bun "aarch64" "bun-arm64"
download_bun "x64"     "bun-x64"

download_bun_windows() {
  local out_path="$BUN_DIR/bun-windows.exe"

  if [ -f "$out_path" ]; then
    log "bun windows-x64 already downloaded"
    return
  fi

  info "Downloading bun $BUN_VERSION for windows-x64..."
  local url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-windows-x64.zip"
  local tmp_zip="/tmp/bun-windows-x64.zip"

  curl -L --progress-bar -o "$tmp_zip" "$url"
  unzip -p "$tmp_zip" "bun-windows-x64/bun.exe" > "$out_path"
  chmod +x "$out_path"
  rm -f "$tmp_zip"

  log "bun windows-x64 downloaded → installer-resources/bun/bun-windows.exe ($(du -sh "$out_path" | cut -f1))"
}

download_bun_windows

# ── OpenClaw dist ─────────────────────────────────────────────────────────────
info "Copying OpenClaw compiled dist from workspace..."

if [ ! -d "$WORKSPACE_DIR/dist" ]; then
  echo ""
  echo "ERROR: $WORKSPACE_DIR/dist not found."
  echo "Run the OpenClaw build first:"
  echo "  cd $WORKSPACE_DIR && pnpm install && pnpm build"
  exit 1
fi

if [ ! -d "$WORKSPACE_DIR/docs/reference/templates" ]; then
  echo "ERROR: $WORKSPACE_DIR/docs/reference/templates not found."
  exit 1
fi

mkdir -p "$OPENCLAW_DIR"

# Copy compiled dist (self-contained JS chunks, no TS needed)
rsync -a --delete "$WORKSPACE_DIR/dist/" "$OPENCLAW_DIR/dist/"

# Workspace templates required for agent boot (AGENTS.md, SOUL.md, etc.)
mkdir -p "$OPENCLAW_DIR/docs/reference"
rsync -a --delete "$WORKSPACE_DIR/docs/reference/templates/" "$OPENCLAW_DIR/docs/reference/templates/"

# Bundled extensions (channel plugins: whatsapp, telegram, discord, etc.)
if [ ! -d "$WORKSPACE_DIR/extensions" ]; then
  echo "ERROR: $WORKSPACE_DIR/extensions not found."
  exit 1
fi
rsync -a --delete --exclude='node_modules' "$WORKSPACE_DIR/extensions/" "$OPENCLAW_DIR/extensions/"
log "Extensions copied ($(du -sh "$OPENCLAW_DIR/extensions" | cut -f1))"

# Bundled skills (built-in agent skills)
if [ ! -d "$WORKSPACE_DIR/skills" ]; then
  echo "ERROR: $WORKSPACE_DIR/skills not found."
  exit 1
fi
rsync -a --delete "$WORKSPACE_DIR/skills/" "$OPENCLAW_DIR/skills/"
log "Skills copied ($(du -sh "$OPENCLAW_DIR/skills" | cut -f1))"

# Entry point and dependency manifest
cp "$WORKSPACE_DIR/openclaw.mjs"  "$OPENCLAW_DIR/openclaw.mjs"
cp "$WORKSPACE_DIR/package.json"  "$OPENCLAW_DIR/package.json"

log "OpenClaw dist copied ($(du -sh "$OPENCLAW_DIR/dist" | cut -f1))"
log "Templates copied ($(du -sh "$OPENCLAW_DIR/docs/reference/templates" | cut -f1))"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
log "Bundle resources prepared:"
echo "  installer-resources/bun/bun-arm64                     $(du -sh "$BUN_DIR/bun-arm64" | cut -f1)"
echo "  installer-resources/bun/bun-x64                       $(du -sh "$BUN_DIR/bun-x64"   | cut -f1)"
echo "  installer-resources/bun/bun-windows.exe               $(du -sh "$BUN_DIR/bun-windows.exe" | cut -f1)"
echo "  installer-resources/openclaw/dist                     $(du -sh "$OPENCLAW_DIR/dist"  | cut -f1)"
echo "  installer-resources/openclaw/extensions               $(du -sh "$OPENCLAW_DIR/extensions" | cut -f1)"
echo "  installer-resources/openclaw/skills                   $(du -sh "$OPENCLAW_DIR/skills" | cut -f1)"
echo "  installer-resources/openclaw/docs/reference/templates $(du -sh "$OPENCLAW_DIR/docs/reference/templates" | cut -f1)"
echo ""
echo "Now run: pnpm run package   (or scripts/build-and-upload-s3.sh)"

#!/bin/bash
# Prepare installer-resources/{bun,openclaw} before building the DMG.
# Run this once (after building openclaw: pnpm run build at repo root)
# before building the desktop app.
#
# Responsibilities are split into:
#   1. Download Bun binaries — stays in this script (mac-local-only flavor).
#   2. Copy OpenClaw compiled output into installer-resources/openclaw/ —
#      delegated to prepare-openclaw-bundle.mjs (shared with CI workflows).
#
# Output layout (used by electron-builder extraResources):
#   installer-resources/bun/bun-arm64                     ← Bun binary for Apple Silicon
#   installer-resources/bun/bun-x64                       ← Bun binary for Intel
#   installer-resources/bun/bun-windows.exe               ← Bun binary for Windows
#   installer-resources/openclaw/dist/                    ← compiled OpenClaw JS
#   installer-resources/openclaw/extensions/              ← bundled channel plugins
#   installer-resources/openclaw/skills/                  ← bundled agent skills
#   installer-resources/openclaw/docs/reference/templates ← workspace templates
#   installer-resources/openclaw/openclaw.mjs
#   installer-resources/openclaw/package.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
# The OpenClaw core is vendored at the repo root:
# apps/desktop → apps → repo root → openclaw/
WORKSPACE_DIR="$(cd "$DESKTOP_DIR/../../openclaw" && pwd)"

# Keep this version in sync with .github/workflows/{build-desktop,release}.yml
# so the gateway runtime is identical across local + CI builds.
BUN_VERSION="1.3.9"
BUN_DIR="$DESKTOP_DIR/installer-resources/bun"
# Node runtime used to RUN openclaw (gateway + CLI). openclaw requires
# node:sqlite (Node 22.5+/24+), which bun does not provide — so the gateway
# and `agents add` need a real Node runtime. Bun stays only as the dependency
# installer. Keep in sync with .github/workflows/{build-desktop,release}.yml.
NODE_VERSION="24.18.0"
NODE_DIR="$DESKTOP_DIR/installer-resources/node"
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

# ── node binaries ────────────────────────────────────────────────────────────
# Runtime that actually executes openclaw.mjs (gateway + CLI). Needed for
# node:sqlite; bun above is install-only.
mkdir -p "$NODE_DIR"

download_node() {
  local arch="$1"        # arm64 | x64
  local out_name="$2"    # node-arm64 | node-x64
  local out_path="$NODE_DIR/$out_name"

  if [ -f "$out_path" ]; then
    log "node $arch already downloaded"
    return
  fi

  info "Downloading node v$NODE_VERSION for darwin-$arch..."
  local url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
  local tmp_tgz="/tmp/node-darwin-${arch}.tar.gz"

  curl -L --progress-bar -o "$tmp_tgz" "$url"
  # Extract just the node binary to stdout → out_path (no full unpack needed).
  tar -xzO -f "$tmp_tgz" "node-v${NODE_VERSION}-darwin-${arch}/bin/node" > "$out_path"
  chmod +x "$out_path"
  rm -f "$tmp_tgz"

  log "node $arch downloaded → installer-resources/node/$out_name ($(du -sh "$out_path" | cut -f1))"
}

download_node "arm64" "node-arm64"
download_node "x64"   "node-x64"

download_node_windows() {
  local out_path="$NODE_DIR/node-windows.exe"

  if [ -f "$out_path" ]; then
    log "node windows-x64 already downloaded"
    return
  fi

  info "Downloading node v$NODE_VERSION for win-x64..."
  local url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"
  local tmp_zip="/tmp/node-win-x64.zip"

  curl -L --progress-bar -o "$tmp_zip" "$url"
  unzip -p "$tmp_zip" "node-v${NODE_VERSION}-win-x64/node.exe" > "$out_path"
  chmod +x "$out_path"
  rm -f "$tmp_zip"

  log "node windows-x64 downloaded → installer-resources/node/node-windows.exe ($(du -sh "$out_path" | cut -f1))"
}

download_node_windows

# ── Auto-build Control UI for local dev ──────────────────────────────────────
# CI workflows always run `pnpm ui:build` explicitly before invoking the
# shared Node script. For local dev convenience, build it here if missing
# so `dist:s3` doesn't fail on a fresh `pnpm run build` (which doesn't run
# ui:build).
if [ ! -f "$WORKSPACE_DIR/dist/control-ui/index.html" ]; then
  info "dist/control-ui not built yet — running pnpm ui:build (one-time per dist)..."
  (cd "$WORKSPACE_DIR" && pnpm ui:build) || {
    echo ""
    echo "ERROR: pnpm ui:build failed in $WORKSPACE_DIR."
    echo "Fix the UI build then re-run prepare-bundle.sh."
    exit 1
  }
fi

# ── OpenClaw payload (delegated to shared Node script) ───────────────────────
OPENCLAW_BUNDLE_STAMP_BUN_VERSION="$BUN_VERSION" \
  node "$SCRIPT_DIR/prepare-openclaw-bundle.mjs" "$WORKSPACE_DIR" "$OPENCLAW_DIR"

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

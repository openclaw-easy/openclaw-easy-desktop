#!/usr/bin/env bash
# Build the Electron app with Developer ID signing and upload DMGs to S3.
#
# Prerequisites:
#   1. Developer ID Application certificate in your Keychain
#   2. OpenClaw built at repo root: cd ../../../ && pnpm install && pnpm run build
#   3. (Optional) AWS credentials for S3 upload
#
# Required env vars for S3 upload:
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#
# Optional env vars:
#   AWS_REGION           default: us-east-1
#   S3_BUCKET            default: openclaw-easy.com-website
#   S3_PREFIX            default: downloads
#   SKIP_UPLOAD          set to 1 to build only, skip S3 upload

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$DESKTOP_DIR"

# ── Validate tools ────────────────────────────────────────────────────────────
for tool in node npx; do
  if ! command -v "$tool" &>/dev/null; then
    echo "Error: '$tool' is not installed or not on PATH." >&2
    exit 1
  fi
done

# ── Step 1: Prepare installer-resources (bun + openclaw dist) ─────────────────
echo ""
echo "▶ Preparing installer resources..."
bash "$SCRIPT_DIR/prepare-bundle.sh"

# ── Step 2: Compile TypeScript / renderer ─────────────────────────────────────
echo ""
echo "▶ Compiling desktop app..."
npm run build

# ── Step 3: Build and sign DMGs with Developer ID cert from Keychain ──────────
# electron-builder auto-discovers the Developer ID Application cert.
# No manual codesign needed — it handles signing + entitlements.
OUTPUT_DIR="dist-installers"
rm -rf "$OUTPUT_DIR"

VERSION=$(node -p "require('./package.json').version")

echo ""
echo "▶ Building arm64 DMG (Developer ID signed)..."
npx electron-builder --mac dmg --arm64 --publish never \
  --config electron-builder.yml

echo ""
echo "▶ Building x64 DMG (Developer ID signed)..."
npx electron-builder --mac dmg --x64 --publish never \
  --config electron-builder.yml

# ── Locate built DMGs ────────────────────────────────────────────────────────
ARM64_SRC="${OUTPUT_DIR}/Openclaw-Easy-${VERSION}-arm64.dmg"
X64_SRC="${OUTPUT_DIR}/Openclaw-Easy-${VERSION}-x64.dmg"

if [[ ! -f "$ARM64_SRC" ]]; then
  echo "Error: arm64 DMG not found at $ARM64_SRC" >&2
  ls "$OUTPUT_DIR"/ >&2
  exit 1
fi
if [[ ! -f "$X64_SRC" ]]; then
  echo "Error: x64 DMG not found at $X64_SRC" >&2
  ls "$OUTPUT_DIR"/ >&2
  exit 1
fi

echo ""
echo "▶ Built DMGs:"
echo "    $ARM64_SRC ($(du -sh "$ARM64_SRC" | cut -f1))"
echo "    $X64_SRC   ($(du -sh "$X64_SRC" | cut -f1))"

# ── Skip upload if requested ──────────────────────────────────────────────────
if [[ "${SKIP_UPLOAD:-0}" == "1" ]]; then
  echo ""
  echo "✓ Build complete (upload skipped — SKIP_UPLOAD=1)"
  exit 0
fi

# ── Validate S3 env vars ─────────────────────────────────────────────────────
: "${AWS_ACCESS_KEY_ID:?Missing AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?Missing AWS_SECRET_ACCESS_KEY}"
S3_BUCKET="${S3_BUCKET:-openclaw-easy.com-website}"
AWS_REGION="${AWS_REGION:-us-east-1}"
S3_PREFIX="${S3_PREFIX:-downloads}"

if ! command -v aws &>/dev/null; then
  echo "Error: 'aws' CLI is not installed. Set SKIP_UPLOAD=1 to skip." >&2
  exit 1
fi

# ── Upload to S3 ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Uploading to s3://${S3_BUCKET}/${S3_PREFIX}/ ..."

aws s3 cp "$ARM64_SRC" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/OpenclawEasy-arm64.dmg" \
  --region "$AWS_REGION" \
  --content-type "application/x-apple-diskimage" \
  --no-progress

aws s3 cp "$X64_SRC" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/OpenclawEasy-x64.dmg" \
  --region "$AWS_REGION" \
  --content-type "application/x-apple-diskimage" \
  --no-progress

aws s3 cp "$ARM64_SRC" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/v${VERSION}/Openclaw-Easy-${VERSION}-arm64.dmg" \
  --region "$AWS_REGION" \
  --content-type "application/x-apple-diskimage" \
  --no-progress

aws s3 cp "$X64_SRC" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/v${VERSION}/Openclaw-Easy-${VERSION}-x64.dmg" \
  --region "$AWS_REGION" \
  --content-type "application/x-apple-diskimage" \
  --no-progress

MANIFEST=$(cat <<JSON
{
  "version": "${VERSION}",
  "releaseDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "arm64": "${S3_PREFIX}/OpenclawEasy-arm64.dmg",
    "x64":   "${S3_PREFIX}/OpenclawEasy-x64.dmg"
  },
  "history": {
    "arm64": "${S3_PREFIX}/v${VERSION}/Openclaw-Easy-${VERSION}-arm64.dmg",
    "x64":   "${S3_PREFIX}/v${VERSION}/Openclaw-Easy-${VERSION}-x64.dmg"
  }
}
JSON
)

echo "$MANIFEST" | aws s3 cp - \
  "s3://${S3_BUCKET}/${S3_PREFIX}/latest.json" \
  --region "$AWS_REGION" \
  --content-type "application/json" \
  --no-progress

echo ""
echo "✓ Upload complete!"
echo ""
echo "  Download URLs:"
echo "    arm64: https://openclaw-easy.com/${S3_PREFIX}/OpenclawEasy-arm64.dmg"
echo "    x64:   https://openclaw-easy.com/${S3_PREFIX}/OpenclawEasy-x64.dmg"
echo ""
echo "  Manifest: https://openclaw-easy.com/${S3_PREFIX}/latest.json"

#!/bin/sh
# Photo Curator v3.0.4 — extension/build.sh
# Purpose: One-shot Docker build script for the Chrome extension.
#          Runs npm install + plasmo prod build inside node:20 container.
#          Outputs built extension to ./build/chrome-mv3-prod/ on host.
#          No npm required on the host.
#
# Usage:
#   chmod +x build.sh && ./build.sh
#
# Output:
#   extension/build/chrome-mv3-prod/  ← load this folder in Chrome as unpacked extension
#
# Changelog:
#   v3.0.4 — Removed --ignore-scripts and separate sharp reinstall.
#             Sharp 0.33+ override in package.json uses npm-distributed prebuilts
#             so no GitHub download or native compilation needed.
#             Added assets/icon.png so Plasmo skips icon generation.
#   v3.0.3 — Used --ignore-scripts + separate sharp reinstall (failed on 403).
#   v3.0.2 — Switched to node:20-bullseye (did not fix gyp).
#   v3.0.1 — Initial version.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📷 Photo Curator v3.0.4 — Extension Builder"
echo "📁 Source: $SCRIPT_DIR"
echo "📦 Output: $SCRIPT_DIR/build/chrome-mv3-prod/"
echo ""

docker run --rm \
  -v "$SCRIPT_DIR":/app \
  -w /app \
  node:20 \
  sh -c "
    echo '▶ Cleaning previous install...' &&
    rm -rf /app/node_modules || true &&
    echo '▶ Installing dependencies...' &&
    npm install &&
    echo '▶ Building extension (prod)...' &&
    npm run build &&
    echo '' &&
    echo '✅ Build complete. Output files:' &&
    find /app/build/chrome-mv3-prod -type f | sort | while read f; do
      size=\$(du -h \"\$f\" | cut -f1)
      echo \"  \$size  \${f#/app/build/chrome-mv3-prod/}\"
    done
  "

echo ""
echo "👉 Load in Chrome:"
echo "   chrome://extensions → Developer mode → Load unpacked"
echo "   → Select: $SCRIPT_DIR/build/chrome-mv3-prod/"

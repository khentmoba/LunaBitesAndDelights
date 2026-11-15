#!/bin/bash
set -e

echo "============================================"
echo "  Luna Bites & Delights — Build & Deploy"
echo "============================================"
echo

cd "$(dirname "$0")"

echo "Building from ROOT directory (active codebase)..."
npm ci --prefix app
npm run build --prefix app

echo
echo "Deploying to Firebase Hosting..."
npx --no-install firebase deploy --only hosting

echo
echo "============================================"
echo "  Deploy complete!"
echo "  https://lunabitesanddelights.web.app  (canonical)"
echo "  https://lunaexpress.web.app          (301 redirect)"
echo "============================================"

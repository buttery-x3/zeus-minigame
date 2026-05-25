#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

git pull --ff-only
npm ci
VITE_BASE_PATH=/zeus/ npm run build
npm run pm2:reload
pm2 save
pm2 status zeus-minigame

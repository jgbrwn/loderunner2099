#!/bin/bash
# Deploy script for Lode Runner 2099
set -e

cd /home/exedev/loderunner2099

# Persistent owner-only stats. StateDirectory in loderunner2099.service handles fresh
# systemd installations; this also upgrades existing services without recreating the unit.
if [ "${STATS_ENABLED:-true}" != "false" ]; then
  sudo install -d -o "${USER:-exedev}" -g "${USER:-exedev}" -m 0750 /var/lib/loderunner2099
fi

echo "📦 Building game..."
npm run build

echo "🔨 Building server..."
go build -o server .

echo "🔄 Restarting service..."
sudo systemctl restart loderunner2099

echo "✅ Deployed! Check status with: sudo systemctl status loderunner2099"
echo "🌐 Game: https://loderunner2099.exe.xyz/  (TV: /tv, phone pad: /pad, Android TV APK: /app after android/build.sh)"
if [ "${STATS_ENABLED:-true}" != "false" ]; then
  echo "📊 Private stats: https://loderunner2099.exe.xyz:${STATS_PORT:-8001}/stats  (JSON: ?format=json)"
fi

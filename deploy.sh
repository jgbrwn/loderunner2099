#!/bin/bash
# Deploy script for Lode Runner 2099
set -e

cd /home/exedev/loderunner2099

echo "📦 Building game..."
npm run build

echo "🔨 Building server..."
go build -o server .

echo "🔄 Restarting service..."
sudo systemctl restart loderunner2099

echo "✅ Deployed! Check status with: sudo systemctl status loderunner2099"
echo "🌐 Game: https://loderunner2099.exe.xyz/  (TV: /tv, phone pad: /pad, Android TV APK: /app after android/build.sh)"

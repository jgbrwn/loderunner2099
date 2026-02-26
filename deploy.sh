#!/bin/bash
# Deploy script for Lode Runner 2099
set -e

cd /home/exedev/loderunner2099

echo "📦 Building game..."
npm run build

echo "🔨 Building server..."
go build -o server server.go

echo "🔄 Restarting service..."
sudo systemctl restart loderunner2099

echo "✅ Deployed! Check status with: sudo systemctl status loderunner2099"
echo "🌐 Game available at: https://loderunner2099.exe.xyz:8000/"

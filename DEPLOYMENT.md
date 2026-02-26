# Deployment Guide

This guide covers deploying Lode Runner 2099 to a production environment with optimal performance.

## Overview

The production setup uses:
- **Vite** for building optimized static assets
- **Go server** for serving files with proper caching headers
- **systemd** for process management and auto-restart

## Prerequisites

- Node.js 18+ and npm
- Go 1.21+
- Linux server with systemd
- (Optional) Reverse proxy like nginx or Caddy for HTTPS

## Build Process

### 1. Build the Game

```bash
# Install dependencies
npm install

# Build production assets
npm run build
```

This creates optimized files in `dist/`:
- `index.html` - Entry point
- `assets/*.js` - Bundled JavaScript with content hashes
- `assets/*.css` - Bundled styles with content hashes

### 2. Build the Server

The Go server (`server.go`) provides:
- Static file serving from `dist/`
- Optimized caching headers
- Gzip compression support

```bash
# Build the server binary
go build -o server server.go
```

## Caching Strategy

The server implements a smart caching strategy:

| File Type | Cache Control | Rationale |
|-----------|---------------|----------|
| `index.html` | `no-cache, must-revalidate` | Always check for updates |
| `*.js`, `*.css` (hashed) | `max-age=31536000, immutable` | 1 year, content-addressed |
| Images | `max-age=604800` | 1 week |
| Fonts | `max-age=31536000, immutable` | 1 year |
| Other | `max-age=3600` | 1 hour default |

This ensures:
- Users always get the latest `index.html`
- Hashed assets are cached aggressively (they change on every build)
- Good balance of freshness and performance

## systemd Service

### 1. Create Service File

Create `/etc/systemd/system/loderunner2099.service`:

```ini
[Unit]
Description=Lode Runner 2099 Game Server
After=network.target

[Service]
Type=simple
User=exedev
Group=exedev
WorkingDirectory=/home/exedev/loderunner2099
ExecStart=/home/exedev/loderunner2099/server
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/exedev/loderunner2099

[Install]
WantedBy=multi-user.target
```

### 2. Enable and Start

```bash
# Copy service file
sudo cp loderunner2099.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable loderunner2099

# Start the service
sudo systemctl start loderunner2099
```

### 3. Management Commands

```bash
# Check status
sudo systemctl status loderunner2099

# View logs
journalctl -u loderunner2099 -f

# Restart after updates
sudo systemctl restart loderunner2099

# Stop the service
sudo systemctl stop loderunner2099
```

## Quick Deploy Script

Create a `deploy.sh` script for easy updates:

```bash
#!/bin/bash
set -e

echo "Building game assets..."
npm run build

echo "Building server..."
go build -o server server.go

echo "Restarting service..."
sudo systemctl restart loderunner2099

echo "Deployment complete!"
sudo systemctl status loderunner2099 --no-pager
```

```bash
chmod +x deploy.sh
./deploy.sh
```

## Server Configuration

The Go server listens on port 8000 by default. Key configuration in `server.go`:

```go
const (
    port    = ":8000"
    distDir = "dist"
)
```

To change the port, modify `server.go` and rebuild.

## HTTPS with Reverse Proxy

For production HTTPS, use a reverse proxy. Example with Caddy:

```
loderunner2099.example.com {
    reverse_proxy localhost:8000
}
```

Or with nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name loderunner2099.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Monitoring

### Health Check

The server responds to requests at `/` with the game. For monitoring, check:

```bash
curl -I http://localhost:8000/
```

Expected: `HTTP/1.1 200 OK`

### Log Analysis

```bash
# Recent errors
journalctl -u loderunner2099 -p err -n 50

# Access patterns (if logging enabled)
journalctl -u loderunner2099 --since "1 hour ago"
```

## Troubleshooting

### Service won't start

```bash
# Check for errors
journalctl -u loderunner2099 -n 100

# Verify binary exists and is executable
ls -la /home/exedev/loderunner2099/server

# Test running manually
cd /home/exedev/loderunner2099 && ./server
```

### Port already in use

```bash
# Find what's using port 8000
sudo lsof -i :8000

# Kill the process or change the port in server.go
```

### Assets not updating

1. Ensure `npm run build` completed successfully
2. Hard refresh browser (Ctrl+Shift+R)
3. Check that `dist/` contains new files with new hashes
4. Verify server was restarted after build

## Performance Tips

1. **Enable gzip** - The Go server supports Accept-Encoding; ensure your proxy passes it through
2. **Use HTTP/2** - Configure your reverse proxy for HTTP/2 support
3. **CDN** - For global distribution, put a CDN in front of the server
4. **Preload hints** - The `index.html` can include preload hints for critical assets

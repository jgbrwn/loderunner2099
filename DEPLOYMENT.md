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

## Overhaul additions (Go server, `*.go` at repo root)
- `/tv`, `/pad` → `dist/tv.html`, `dist/pad.html` (no-cache, like all HTML).
- `/ws/tv`, `/ws/pad` — WebSocket pairing rooms, see `docs/overhaul/PROTOCOL.md`. Same-origin only;
  extra origins via `ALLOWED_ORIGINS=host1,host2` env.
- `/api/radio/now` (Radio Paradise now-playing, 15 s cache), `/api/qr?text=` (PNG).
- `/app` → Android TV APK (`dist/loderunner2099.apk` or `android/out/loderunner2099.apk`).
  Build: `android/build.sh` (needs JDK 17+, installs the Android SDK to ~/android-sdk; `PUBLIC_URL=` to change the
  server it opens). Sideload on the TV box with e.g. Downloader → `https://HOST/app`.
- Tests: `go test ./...`

The Go server (`server.go`) provides:
- Static file serving from `dist/`
- Optimized caching headers
- Gzip compression support

```bash
# Build the server binary
go build -o server .
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
Environment=PORT=8000
Environment=STATS_ENABLED=true
Environment=STATS_PORT=8001
Environment=STATS_BIND=0.0.0.0
Environment=STATS_FILE=/var/lib/loderunner2099/stats.json
# Creates /var/lib/loderunner2099 owned by User=/Group= before starting.
StateDirectory=loderunner2099
StateDirectoryMode=0750

# Optional security hardening. Keep the state directory writable if enabling
# ProtectSystem=strict; StateDirectory normally adds the necessary writable path.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/exedev/loderunner2099 /var/lib/loderunner2099

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
go build -o server .

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

## Private operations dashboard

The game process also serves a live operations dashboard on port **8001**:

- HTML: `https://loderunner2099.exe.xyz:8001/stats`
- JSON: `https://loderunner2099.exe.xyz:8001/stats?format=json`
- On the VM: `http://localhost:8001/stats`

It is deliberately not mounted on the public game listener (`/stats` there returns 404).
The alternate exe.dev proxy port uses owner/VM-user authentication. On another host, do not expose
this port publicly: bind `STATS_BIND=127.0.0.1` and reverse-proxy it behind your own authentication,
or restrict port 8001 to trusted networks. The server does not add its own dashboard password.

Configuration (the repository's `loderunner2099.service` is a working example):

| Environment variable | Default | Purpose |
|---|---|---|
| `STATS_ENABLED` | `true` | Set `false`, `off`, `0`, or `no` to disable the dashboard, persistence, and `/api/presence`. |
| `STATS_PORT` | `8001` | Alternate HTTP listener. Never mounted on public game port 8000. |
| `STATS_BIND` | `0.0.0.0` | Listener address; use `127.0.0.1` behind a local authenticated reverse proxy. |
| `STATS_FILE` | `/var/lib/loderunner2099/stats.json` | Aggregate totals/history file. Set `off` to run the dashboard without persistence. |

**Required deployment files:** the Go server binary built from the repository root, `dist/` from
`npm run build`, and a systemd unit such as `loderunner2099.service`. For persistence, either keep
`StateDirectory=loderunner2099` in the unit (recommended), or create the directory yourself:

```bash
sudo install -d -o exedev -g exedev -m 0750 /var/lib/loderunner2099
sudo cp loderunner2099.service /etc/systemd/system/loderunner2099.service
sudo systemctl daemon-reload
sudo systemctl enable --now loderunner2099
```

If changing `User=` or `Group=`, change the directory ownership too. `deploy.sh` also creates this
directory for existing exe.dev installations. No database, migration, npm service, or extra process
is required. The directory is only needed when stats and persistence are enabled.

Lifetime counters and the last 24 hours of activity samples are saved atomically every 15 seconds
when dirty, so they survive restarts and redeploys (a forced stop can lose at most the unsaved
interval). Graceful restarts also flush once on shutdown. The dashboard displays a warning if
persistence cannot be written. The JSON response
includes `history24h`, five-minute average samples for Internet sessions, active player seats and
idle connections (including Internet controllers). Missing samples are downtime, not zero activity.

Game tabs send anonymous, coarse presence heartbeats to `/api/presence` every 15 seconds:
menu/play/pause/over/idle/hidden, game mode, level, player-seat count, and input idle age when
`STATS_ENABLED` is true. The endpoint returns 404 and collection is inert when stats are disabled.
No player names, session IDs, room codes, seeds, IP addresses, or game payloads are persisted.
Only aggregate counters and five-minute activity samples are written to disk. Pairing
WebSockets additionally provide room and controller activity; phone keepalives with no buttons
pressed do not count as activity. “Internet” means the request arrived through the external
proxy; local development sessions are shown separately.

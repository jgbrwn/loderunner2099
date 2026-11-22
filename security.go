package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// clientIP: the peer address, or — when the peer is a local/private proxy — the right-most X-Forwarded-For entry
// (the address the proxy itself saw; left-most entries are client-controlled).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if p := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(p) != nil {
				return p
			}
		}
	}
	return host
}

// limiter: per-key token bucket (burst, one token per `every`).
type limiter struct {
	mu      sync.Mutex
	burst   float64
	every   time.Duration
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newLimiter(burst int, every time.Duration) *limiter {
	return &limiter{burst: float64(burst), every: every, buckets: map[string]*bucket{}}
}

func (l *limiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.buckets[key]
	if b == nil {
		if len(l.buckets) > 50000 { // crude memory cap: forget full buckets
			for k, v := range l.buckets {
				if v.tokens+float64(now.Sub(v.at))/float64(l.every) >= l.burst {
					delete(l.buckets, k)
				}
			}
		}
		b = &bucket{tokens: l.burst, at: now}
		l.buckets[key] = b
	}
	b.tokens += float64(now.Sub(b.at)) / float64(l.every)
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// connCounter caps concurrent WebSockets per IP.
type connCounter struct {
	mu  sync.Mutex
	max int
	n   map[string]int
}

func (c *connCounter) acquire(ip string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.n[ip] >= c.max {
		return false
	}
	c.n[ip]++
	return true
}

func (c *connCounter) release(ip string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.n[ip]--; c.n[ip] <= 0 {
		delete(c.n, ip)
	}
}

var (
	wsLimit  = newLimiter(30, 2*time.Second)        // WS connects per IP
	apiLimit = newLimiter(60, 500*time.Millisecond) // /api/* per IP
	wsConns  = &connCounter{max: 24, n: map[string]int{}}
)

func tooMany(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "10")
	http.Error(w, "too many requests", http.StatusTooManyRequests)
}

// limitWS rate-limits WebSocket upgrades and caps concurrent sockets per IP.
func limitWS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !wsLimit.allow(ip) || !wsConns.acquire(ip) {
			tooMany(w)
			return
		}
		defer wsConns.release(ip)
		h(w, r)
	}
}

func limitAPI(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !apiLimit.allow(clientIP(r)) {
			tooMany(w)
			return
		}
		h(w, r)
	}
}

// securityHeaders: CSP compatible with Phaser (canvas/WebGL, blob/data images, inline styles), Radio Paradise
// stream + cover art, same-origin WebSockets.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		ws := "wss://" + r.Host + " ws://" + r.Host
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
			"img-src 'self' data: blob: https://*.radioparadise.com; media-src 'self' blob: data: https://*.radioparadise.com; "+
			"connect-src 'self' "+ws+" https://*.radioparadise.com; font-src 'self' data:; worker-src 'self' blob:; "+
			"manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

// cleanName strips control and markup characters from a display name.
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || strings.ContainsRune("<>&\"'`", r) || r == 0xfffd {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, ""))
	if rs := []rune(strings.TrimSpace(s)); len(rs) > 16 {
		return string(rs[:16])
	}
	return strings.TrimSpace(s)
}

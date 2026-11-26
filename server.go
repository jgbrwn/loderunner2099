package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func statsConfigured() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("STATS_ENABLED"))) {
	case "0", "false", "off", "no", "disabled":
		return false
	default:
		return true
	}
}

func main() {
	port := "8000"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}
	distDir := "./dist"
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		log.Fatal("dist/ directory not found. Run 'npm run build' first.")
	}
	hub := NewHub(strings.Split(os.Getenv("ALLOWED_ORIGINS"), ","))
	presence := NewPresence()
	statsEnabled := statsConfigured()
	var store *statsStore
	if statsEnabled {
		store = openStatsStore()
		hub.store, presence.store = store, store
		store.load(hub, presence)
	}
	go hub.janitor(30 * time.Second)
	go func() {
		sampleStats(hub, presence, time.Now())
		for now := range time.Tick(30 * time.Second) {
			sampleStats(hub, presence, now)
		}
	}()
	radio := NewRadio(nil)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           newMux(distDir, hub, radio, presence),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,  // covers header+body of a normal request; WS upgrade returns before body read
		IdleTimeout:       120 * time.Second, // keep-alive reaped. WriteTimeout deliberately unset: it would kill
		// long-lived WebSockets; coder/websocket's 20s ping handles dead WS peers instead.
	}
	// Owner-only dashboard on an alternate port. Alternate exe.dev proxy ports are
	// authenticated for VM users; the dashboard is never mounted on the public game port.
	if statsEnabled {
		statsPort := os.Getenv("STATS_PORT")
		if statsPort == "" {
			statsPort = "8001"
		}
		statsBind := os.Getenv("STATS_BIND")
		if statsBind == "" {
			statsBind = "0.0.0.0"
		}
		statsSrv := &http.Server{Addr: statsBind + ":" + statsPort, Handler: statsMux(hub, presence), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			log.Printf("📊 Private stats: http://%s:%s/stats", statsBind, statsPort)
			if err := statsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("stats server: %v", err)
			}
		}()
	} else {
		log.Printf("📊 Stats dashboard and presence collection disabled (STATS_ENABLED=false)")
	}
	log.Printf("🎮 Lode Runner 2099 server running on http://localhost:%s (serving %s)", port, distDir)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	log.Printf("shutting down; flushing stats")
	shutdown, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	if store != nil {
		store.close()
	}
}

func newMux(distDir string, hub *Hub, radio *Radio, presence ...*Presence) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/tv", limitWS(hub.HandleTV))
	mux.HandleFunc("/ws/pad", limitWS(hub.HandlePad))
	mux.HandleFunc("/api/radio/now", limitAPI(radio.Handle))
	mux.HandleFunc("/api/radio/soma", limitAPI(NewSoma(nil).Handle))
	mux.HandleFunc("/api/qr", limitAPI(handleQR))
	if len(presence) > 0 && presence[0] != nil && statsConfigured() {
		mux.HandleFunc("/api/presence", limitAPI(presence[0].Handle))
	}
	mux.HandleFunc("/app", func(w http.ResponseWriter, r *http.Request) { serveAPK(w, r, distDir) })
	mux.HandleFunc("/", staticHandler(distDir))
	static := gzipStatic(distDir, mux)
	mux2 := http.NewServeMux()
	mux2.Handle("/", static)
	return securityHeaders(mux2)
}

var pageRoutes = map[string]string{"/tv": "tv.html", "/tv/": "tv.html", "/pad": "pad.html", "/pad/": "pad.html"}

func noCache(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}

func staticHandler(distDir string) http.HandlerFunc {
	fs := http.FileServer(http.Dir(distDir))
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if page, ok := pageRoutes[path]; ok {
			noCache(w)
			http.ServeFile(w, r, filepath.Join(distDir, page))
			return
		}
		ext := strings.ToLower(filepath.Ext(path))
		switch {
		case path == "/" || ext == ".html" || ext == ".webmanifest" || path == "/sw.js":
			// HTML, manifest and service worker: always revalidate
			noCache(w)
		case ext == ".js" || ext == ".css":
			// hashed JS/CSS: immutable
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ext == ".png" || ext == ".jpg" || ext == ".gif" || ext == ".webp" || ext == ".svg" || ext == ".ico":
			w.Header().Set("Cache-Control", "public, max-age=604800")
		case ext == ".woff" || ext == ".woff2" || ext == ".ttf" || ext == ".eot":
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		fs.ServeHTTP(w, r)
	}
}

// serveAPK serves the Android TV wrapper if it has been built.
func serveAPK(w http.ResponseWriter, r *http.Request, distDir string) {
	for _, p := range []string{filepath.Join(distDir, "loderunner2099.apk"), "android/out/loderunner2099.apk"} {
		if _, err := os.Stat(p); err == nil {
			noCache(w)
			w.Header().Set("Content-Type", "application/vnd.android.package-archive")
			w.Header().Set("Content-Disposition", `attachment; filename="loderunner2099.apk"`)
			http.ServeFile(w, r, p)
			return
		}
	}
	http.Error(w, "Android app not built yet", http.StatusNotFound)
}

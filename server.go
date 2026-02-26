package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	port := "8000"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	distDir := "./dist"
	
	// Check if dist exists
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		log.Fatal("dist/ directory not found. Run 'npm run build' first.")
	}

	fs := http.FileServer(http.Dir(distDir))
	
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		
		// Determine caching based on file type
		ext := strings.ToLower(filepath.Ext(path))
		
		switch {
		case path == "/" || path == "/index.html":
			// HTML: no cache - always fetch latest
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
			
		case ext == ".js" || ext == ".css":
			// JS/CSS with hashes: cache for 1 year (immutable)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			
		case ext == ".png" || ext == ".jpg" || ext == ".gif" || ext == ".webp" || ext == ".svg" || ext == ".ico":
			// Images: cache for 1 week
			w.Header().Set("Cache-Control", "public, max-age=604800")
			
		case ext == ".woff" || ext == ".woff2" || ext == ".ttf" || ext == ".eot":
			// Fonts: cache for 1 year
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			
		default:
			// Other files: cache for 1 hour
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		
		fs.ServeHTTP(w, r)
	})

	log.Printf("🎮 Lode Runner 2099 server running on http://localhost:%s", port)
	log.Printf("📦 Serving from %s with optimized caching", distDir)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

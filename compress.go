package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// preCompressed caches the gzipped bytes of static files keyed by (path, modTime, size).
// Only large textual assets benefit; HTML is tiny so we compress it inline.
type cachedGz struct {
	modTime time.Time
	size    int64
	data    []byte
}

var gzCache sync.Map // path -> cachedGz

func gzippedFile(path string, info os.FileInfo) ([]byte, bool) {
	key := path
	if v, ok := gzCache.Load(key); ok {
		c := v.(cachedGz)
		if c.modTime.Equal(info.ModTime()) && c.size == info.Size() {
			return c.data, true
		}
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	var sb strings.Builder
	gz, _ := gzip.NewWriterLevel(&sb, gzip.BestSpeed)
	if _, err := io.Copy(gz, f); err != nil {
		return nil, false
	}
	gz.Close()
	data := []byte(sb.String())
	gzCache.Store(key, cachedGz{modTime: info.ModTime(), size: info.Size(), data: data})
	return data, true
}

// gzipStatic serves .js/.css/.html from dist with pre-computed gzip when the client accepts it.
// Falls through to the normal file server otherwise. Cached by content hash so rebuilds invalidate.
func gzipStatic(distDir string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".js" && ext != ".css" && ext != ".html" && ext != ".json" && ext != ".webmanifest" && path != "/" {
			next.ServeHTTP(w, r)
			return
		}
		rel := strings.TrimPrefix(path, "/")
		if rel == "" {
			rel = "index.html"
		}
		if page, ok := pageRoutes[path]; ok {
			rel = page
		}
		full := filepath.Join(distDir, filepath.Clean("/"+rel))
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			next.ServeHTTP(w, r)
			return
		}
		data, ok := gzippedFile(full, info)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		h.Set("Content-Type", contentTypeFor(full))
		switch {
		case ext == ".js" || ext == ".css":
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		h.Del("Content-Length")
		if r.Method != http.MethodHead {
			w.Write(data)
		}
	})
}

func contentTypeFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json", ".webmanifest":
		return "application/json"
	default:
		return "text/html; charset=utf-8"
	}
}

package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	rpNowURL    = "https://api.radioparadise.com/api/now_playing?chan=0"
	rpStreamURL = "https://stream.radioparadise.com/aac-128"
	radioTTL    = 15 * time.Second
)

type NowPlaying struct {
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	CoverURL  string `json:"coverUrl"`
	StreamURL string `json:"streamUrl"`
}

// Radio caches Radio Paradise's now-playing info.
type Radio struct {
	Client *http.Client
	URL    string
	mu     sync.Mutex
	cached NowPlaying
	at     time.Time
}

func NewRadio(c *http.Client) *Radio {
	if c == nil {
		c = &http.Client{Timeout: 5 * time.Second}
	}
	return &Radio{Client: c, URL: rpNowURL}
}

func parseRP(body []byte) (NowPlaying, error) {
	var raw struct {
		Artist, Title, Cover string
		CoverMed             string `json:"cover_med"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return NowPlaying{}, err
	}
	cover := raw.CoverMed
	if cover == "" {
		cover = raw.Cover
	}
	if !strings.HasPrefix(cover, "https://") || !strings.HasSuffix(strings.SplitN(strings.TrimPrefix(cover, "https://"), "/", 2)[0], ".radioparadise.com") {
		cover = "" // only RP's own image host (CSP img-src allows *.radioparadise.com)
	}
	return NowPlaying{Title: clip(raw.Title, 200), Artist: clip(raw.Artist, 200), CoverURL: cover, StreamURL: rpStreamURL}, nil
}

func (r *Radio) Now(ctx context.Context) NowPlaying {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.at.IsZero() && time.Since(r.at) < radioTTL {
		return r.cached
	}
	np, err := r.fetch(ctx)
	if err != nil {
		// keep serving stale data (or just the stream URL); retry after a short pause
		if r.cached.StreamURL == "" {
			r.cached = NowPlaying{StreamURL: rpStreamURL}
		}
		r.at = time.Now().Add(-radioTTL + 5*time.Second)
		return r.cached
	}
	r.cached, r.at = np, time.Now()
	return np
}

func (r *Radio) fetch(ctx context.Context) (NowPlaying, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", r.URL, nil)
	req.Header.Set("User-Agent", "loderunner2099/1.0")
	resp, err := r.Client.Do(req)
	if err != nil {
		return NowPlaying{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return NowPlaying{}, io.ErrUnexpectedEOF
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return NowPlaying{}, err
	}
	return parseRP(body)
}

func (r *Radio) Handle(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=10")
	json.NewEncoder(w).Encode(r.Now(req.Context()))
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

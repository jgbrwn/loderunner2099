package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testLifetime() lifetimeTotals {
	return lifetimeTotals{Unique: 42, Games: 17, Levels: 81, Rooms: 9, TVConnections: 12,
		PadConnections: 14, TVMessages: 900, PadMessages: 1200, PadInputs: 800}
}

func TestStatsStoreSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "stats.json")
	store := newStatsStore(path)
	h, p := NewHub(nil), NewPresence()
	h.store, p.store = store, store
	store.load(h, p)
	h.mu.Lock()
	h.roomsCreated, h.tvConnections, h.padConnections = 9, 12, 14
	h.tvMessages, h.padMessages, h.padInputs = 900, 1200, 800
	h.mu.Unlock()
	p.unique, p.games, p.levels = 42, 17, 81
	store.add(testLifetime())
	now := time.Now().UTC().Truncate(historyInterval)
	store.record(activityPoint{Internet: 3, ActivePlayers: 2, IdleConnections: 4}, now)
	store.flush()
	store.close()

	reopened := newStatsStore(path)
	defer reopened.close()
	h2, p2 := NewHub(nil), NewPresence()
	h2.store, p2.store = reopened, reopened
	reopened.load(h2, p2)
	u, g, l := p2.lifetime()
	if u != 42 || g != 17 || l != 81 {
		t.Fatalf("presence totals not restored: %d %d %d", u, g, l)
	}
	h2.mu.Lock()
	if h2.roomsCreated != 9 || h2.tvConnections != 12 || h2.padConnections != 14 || h2.padInputs != 800 {
		t.Fatalf("hub totals not restored: %+v", h2)
	}
	h2.mu.Unlock()
	points := reopened.graph(now)
	if len(points) != 1 || points[0].Internet != 3 || points[0].ActivePlayers != 2 || points[0].IdleConnections != 4 {
		t.Fatalf("history not restored: %+v", points)
	}
}

func TestStatsStoreAveragesBucketsAndPrunes(t *testing.T) {
	store := newStatsStore("")
	now := time.Date(2026, 11, 26, 19, 0, 0, 0, time.UTC)
	store.record(activityPoint{Internet: 1, ActivePlayers: 2, IdleConnections: 4}, now)
	store.record(activityPoint{Internet: 3, ActivePlayers: 4, IdleConnections: 8}, now.Add(2*time.Minute))
	store.record(activityPoint{Internet: 5, ActivePlayers: 6, IdleConnections: 10}, now.Add(5*time.Minute))
	points := store.graph(now.Add(5 * time.Minute))
	if len(points) != 2 || points[0].Internet != 2 || points[0].ActivePlayers != 3 || points[0].IdleConnections != 6 || points[0].Samples != 2 {
		t.Fatalf("average %+v", points)
	}
	store.record(activityPoint{Internet: 1}, now.Add(-25*time.Hour))
	if points := store.graph(now); len(points) != 0 {
		t.Fatalf("old history retained: %+v", points)
	}
}

func TestStatsStoreRejectsInvalidFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := newStatsStore(path)
	if len(store.graph(time.Now())) != 0 || store.loaded != (lifetimeTotals{}) {
		t.Fatal("invalid store loaded")
	}
}

func TestStatsFileContainsOnlyAggregates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.json")
	store := newStatsStore(path)
	store.add(lifetimeTotals{Unique: 1})
	store.record(activityPoint{Internet: 1}, time.Now())
	store.flush()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var disk statsDisk
	if json.Unmarshal(data, &disk) != nil || disk.Version != statsVersion {
		t.Fatalf("disk %s", data)
	}
	for _, private := range []string{"sessionId", "roomCode", "address", "playerName", "seed"} {
		if string(data) != "" && containsFold(string(data), private) {
			t.Fatalf("private field %q in %s", private, data)
		}
	}
}

func containsFold(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for j := range sub {
			c := s[i+j]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != sub[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func TestStatsConfigured(t *testing.T) {
	for _, value := range []string{"false", "FALSE", "off", "0", "no", "disabled"} {
		t.Setenv("STATS_ENABLED", value)
		if statsConfigured() {
			t.Fatalf("stats enabled for %q", value)
		}
	}
	for _, value := range []string{"", "true", "on", "1"} {
		t.Setenv("STATS_ENABLED", value)
		if !statsConfigured() {
			t.Fatalf("stats disabled for %q", value)
		}
	}
}

func TestPresenceEndpointDisabled(t *testing.T) {
	t.Setenv("STATS_ENABLED", "false")
	dir := t.TempDir()
	for _, f := range []string{"index.html", "tv.html", "pad.html"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("<html>"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	srv := httptest.NewServer(newMux(dir, NewHub(nil), NewRadio(nil), NewPresence()))
	defer srv.Close()
	resp, err := http.Post(srv.URL+"/api/presence", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("presence status %d", resp.StatusCode)
	}
}

func TestStatsStoreRetryDoesNotDoubleCount(t *testing.T) {
	store := newStatsStore(filepath.Join(t.TempDir(), "stats.json"))
	fail := true
	store.write = func(path string, data []byte) error {
		if fail {
			return os.ErrPermission
		}
		return atomicWriteFile(path, data)
	}
	store.add(lifetimeTotals{Unique: 2, Games: 1})
	store.flush()
	if store.healthy() {
		t.Fatal("failed save reported healthy")
	}
	store.flush()
	fail = false
	store.flush()
	if !store.healthy() || store.loaded.Unique != 2 || store.loaded.Games != 1 {
		t.Fatalf("retry totals %+v", store.loaded)
	}
	if !store.closed {
		store.close()
	}
	reopened := newStatsStore(store.path)
	if reopened.loaded.Unique != 2 || reopened.loaded.Games != 1 {
		t.Fatalf("disk totals %+v", reopened.loaded)
	}
}

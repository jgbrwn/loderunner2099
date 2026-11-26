package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPresenceLifecycleAndStats(t *testing.T) {
	p := NewPresence()
	h := NewHub(nil)
	now := time.Now().Add(time.Second)
	post := func(body string, external bool) int {
		r := httptest.NewRequest(http.MethodPost, "/api/presence", strings.NewReader(body))
		if external {
			r.Header.Set("X-Forwarded-For", "203.0.113.8")
		}
		w := httptest.NewRecorder()
		p.Handle(w, r)
		return w.Code
	}
	if code := post(`{"id":"browser-test-1234","kind":"web","screen":"play","mode":"coop","level":2,"players":2,"idleMs":0}`, true); code != 200 {
		t.Fatalf("presence %d", code)
	}
	if code := post(`{"id":"browser-test-1234","kind":"web","screen":"pause","mode":"coop","level":2,"players":2,"idleMs":1000}`, true); code != 200 {
		t.Fatal(code)
	}
	s := h.stats(p, now)
	if s.ExternalNow != 1 || s.LocalNow != 0 || s.PlayingNow != 0 || s.IdleNow != 1 || s.PlayerSeats != 0 || s.GamesTotal != 1 {
		t.Fatalf("stats %+v", s)
	}
	if code := post(`{"id":"bad","kind":"web","screen":"play","players":1}`, true); code != 400 {
		t.Fatalf("bad id %d", code)
	}
	if code := post(`{"id":"browser-test-1234","kind":"web","screen":"play","mode":"coop","level":3,"players":2,"idleMs":0}`, true); code != 200 {
		t.Fatal(code)
	}
	if s := h.stats(p, now); s.LevelsTotal != 1 || s.PlayingNow != 1 {
		t.Fatalf("resume %+v", s)
	}
	if code := post(`{"id":"browser-test-1234","kind":"web","screen":"hidden","players":1,"gone":true}`, true); code != 200 {
		t.Fatal(code)
	}
	if s := h.stats(p, now); s.ExternalNow != 0 {
		t.Fatal("gone session retained")
	}
}

func TestStatsDashboardAndJSON(t *testing.T) {
	p := NewPresence()
	h := NewHub(nil)
	p.update(presenceUpdate{ID: "dashboard-test-1234", Kind: "web", Screen: "play", Mode: "single", Level: 1, Players: 1}, true, time.Now())
	srv := httptest.NewServer(statsMux(h, p))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/stats")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var b strings.Builder
	buf := make([]byte, 8192)
	for {
		n, e := resp.Body.Read(buf)
		b.Write(buf[:n])
		if e != nil {
			break
		}
	}
	body := b.String()
	if resp.Header.Get("Content-Type") != "text/html; charset=utf-8" || !strings.Contains(body, "Actively playing") || !strings.Contains(body, "Private operations") {
		t.Fatalf("dashboard %s %s", resp.Header.Get("Content-Type"), body[:100])
	}
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/stats?format=json", nil)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	var snap statsSnapshot
	if err := json.NewDecoder(resp2.Body).Decode(&snap); err != nil {
		t.Fatal(err)
	}
	if snap.ExternalNow != 1 || snap.PlayingNow != 1 || snap.UptimeMS < 0 || len(snap.Sessions) != 1 || snap.Sessions[0].ConnectedMS < 0 {
		t.Fatalf("json %+v", snap)
	}
}

func TestPadActivityIsNotInputKeepalive(t *testing.T) {
	// The activity decision is based on a real nonzero button frame, not the 1 s zero keepalive.
	c := &conn{}
	if c.inputs != 0 || !c.lastInput.IsZero() {
		t.Fatal("new connection active")
	}
}

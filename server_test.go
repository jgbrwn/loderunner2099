package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func testServer(t *testing.T) (*httptest.Server, *Hub) {
	dir := t.TempDir()
	for _, f := range []string{"index.html", "tv.html", "pad.html"} {
		os.WriteFile(filepath.Join(dir, f), []byte("<html>"+f), 0o644)
	}
	hub := NewHub(nil)
	srv := httptest.NewServer(newMux(dir, hub, NewRadio(nil)))
	t.Cleanup(srv.Close)
	return srv, hub
}

func dial(t *testing.T, srv *httptest.Server, path string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	return ws
}

func read(t *testing.T, ws *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, b, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

func write(t *testing.T, ws *websocket.Conn, s string) {
	if err := ws.Write(context.Background(), websocket.MessageText, []byte(s)); err != nil {
		t.Fatal(err)
	}
}

func TestPairingFlow(t *testing.T) {
	srv, hub := testServer(t)
	tv := dial(t, srv, "/ws/tv")
	m := read(t, tv)
	code, _ := m["code"].(string)
	if m["t"] != "room" || len(code) != codeLen || strings.ContainsAny(code, "IO01L") {
		t.Fatalf("bad room msg %v", m)
	}
	p1 := dial(t, srv, "/ws/pad?code="+strings.ToLower(code)+"&id=a&name=Ann")
	if m := read(t, p1); m["t"] != "joined" || m["slot"] != 1.0 || m["tv"] != true {
		t.Fatalf("p1 %v", m)
	}
	if m := read(t, tv); m["t"] != "join" || m["slot"] != 1.0 || m["name"] != "Ann" {
		t.Fatalf("tv join %v", m)
	}
	p2 := dial(t, srv, "/ws/pad?code="+code)
	if m := read(t, p2); m["slot"] != 2.0 {
		t.Fatalf("p2 %v", m)
	}
	read(t, tv)
	sp := dial(t, srv, "/ws/pad?code="+code)
	if m := read(t, sp); m["slot"] != 3.0 {
		t.Fatalf("spectator %v", m)
	}
	read(t, tv)
	// taken slot
	bad := dial(t, srv, "/ws/pad?code="+code+"&slot=1")
	if m := read(t, bad); m["error"] != "slot_taken" {
		t.Fatalf("expected slot_taken %v", m)
	}
	if m := read(t, dial(t, srv, "/ws/pad?code=ZZZZ")); m["error"] != "no_room" {
		t.Fatalf("expected no_room %v", m)
	}
	// pad → TV
	write(t, p2, `{"t":"in","b":5}`)
	m = read(t, tv)
	if m["t"] != "pad" || m["slot"] != 2.0 || m["m"].(map[string]any)["b"] != 5.0 {
		t.Fatalf("relay %v", m)
	}
	// TV → one pad, then all
	write(t, tv, `{"to":1,"m":{"t":"rumble","ms":80}}`)
	if m := read(t, p1); m["t"] != "rumble" {
		t.Fatalf("to p1 %v", m)
	}
	write(t, tv, `{"to":0,"m":{"t":"state","s":"play"}}`)
	for _, p := range []*websocket.Conn{p1, p2, sp} {
		if m := read(t, p); m["s"] != "play" {
			t.Fatalf("broadcast %v", m)
		}
	}
	// ping
	write(t, p1, `{"t":"ping"}`)
	if m := read(t, p1); m["t"] != "pong" {
		t.Fatalf("pong %v", m)
	}
	// pad leaves
	p2.Close(websocket.StatusNormalClosure, "")
	if m := read(t, tv); m["t"] != "leave" || m["slot"] != 2.0 {
		t.Fatalf("leave %v", m)
	}
	// TV drops, pads notified, TV reclaims room
	tv.Close(websocket.StatusNormalClosure, "")
	if m := read(t, p1); m["t"] != "tv" || m["up"] != false {
		t.Fatalf("tv down %v", m)
	}
	tv2 := dial(t, srv, "/ws/tv?code="+code)
	if m := read(t, tv2); m["code"] != code || len(m["pads"].([]any)) != 2 {
		t.Fatalf("reclaim %v", m)
	}
	if m := read(t, p1); m["up"] != true {
		t.Fatalf("tv up %v", m)
	}
	// reconnect same id reclaims slot 1
	p1b := dial(t, srv, "/ws/pad?code="+code+"&id=a")
	if m := read(t, p1b); m["slot"] != 1.0 {
		t.Fatalf("reconnect %v", m)
	}
	// sweep removes rooms after TV grace
	tv2.Close(websocket.StatusNormalClosure, "")
	time.Sleep(100 * time.Millisecond)
	hub.sweep(time.Now().Add(tvGraceTimeout + time.Second))
	hub.mu.Lock()
	n := len(hub.rooms)
	hub.mu.Unlock()
	if n != 0 {
		t.Fatalf("rooms left %d", n)
	}
}

func TestOriginRejected(t *testing.T) {
	srv, _ := testServer(t)
	h := http.Header{"Origin": {"https://evil.example"}}
	_, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/tv", &websocket.DialOptions{HTTPHeader: h})
	if err == nil {
		t.Fatal("cross-origin accepted")
	}
}

func TestRoutesAndQR(t *testing.T) {
	srv, _ := testServer(t)
	for path, want := range map[string]string{"/tv": "tv.html", "/pad": "pad.html", "/": "index.html"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var b [64]byte
		n, _ := resp.Body.Read(b[:])
		resp.Body.Close()
		if !strings.Contains(string(b[:n]), want) || !strings.Contains(resp.Header.Get("Cache-Control"), "no-cache") {
			t.Fatalf("%s → %q %v", path, b[:n], resp.Header)
		}
	}
	resp, _ := http.Get(srv.URL + "/api/qr?text=hello")
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("qr %d", resp.StatusCode)
	}
	resp, _ = http.Get(srv.URL + "/api/qr?text=" + strings.Repeat("x", 600))
	if resp.StatusCode != 400 {
		t.Fatalf("long qr %d", resp.StatusCode)
	}
}

func TestRadioParseAndCache(t *testing.T) {
	var hits int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Write([]byte(`{"time":123,"artist":"Temples","title":"Fantasy Realm","cover":"https://x/l.jpg","cover_med":"https://x/m.jpg"}`))
	}))
	defer up.Close()
	r := NewRadio(nil)
	r.URL = up.URL
	np := r.Now(context.Background())
	if np.Title != "Fantasy Realm" || np.Artist != "Temples" || np.CoverURL != "https://x/m.jpg" || np.StreamURL != rpStreamURL {
		t.Fatalf("%+v", np)
	}
	r.Now(context.Background())
	if hits != 1 {
		t.Fatalf("cache miss: %d hits", hits)
	}
	// upstream failure → stream URL still returned
	r2 := NewRadio(nil)
	r2.URL = "http://127.0.0.1:1/"
	if np := r2.Now(context.Background()); np.StreamURL == "" {
		t.Fatal("no fallback stream")
	}
}

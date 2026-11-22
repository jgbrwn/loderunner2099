package main

import (
	"context"
	"testing"
	"time"
)

func tvRoom(t *testing.T, ws func(string) map[string]any, q string) string {
	t.Helper()
	m := ws(q)
	if m["t"] != "room" {
		t.Fatalf("want room, got %v", m)
	}
	return m["code"].(string)
}

func waitTVGone(t *testing.T, hub *Hub, code string) {
	t.Helper()
	for i := 0; i < 100; i++ {
		hub.mu.Lock()
		rm := hub.rooms[code]
		hub.mu.Unlock()
		rm.mu.Lock()
		gone := rm.tv == nil
		rm.mu.Unlock()
		if gone {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("tv never left")
}

func TestPersistentPairing(t *testing.T) {
	srv, hub := testServer(t)
	open := func(q string) map[string]any { // connect, read the room message, hang up
		ws := dial(t, srv, "/ws/tv"+q)
		m := read(t, ws)
		ws.Close(1000, "")
		return m
	}

	ws1 := dial(t, srv, "/ws/tv?token=secret1")
	code := read(t, ws1)["code"].(string)

	// Same token while the old socket is still open: takes over the same code, old conn closed.
	if c := tvRoom(t, open, "?code="+code+"&token=secret1"); c != code {
		t.Fatalf("live takeover got %s want %s", c, code)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, _, err := ws1.Read(ctx); err == nil {
		t.Fatal("old TV conn should be closed")
	}
	// A different token can't take a tokened room, even when its TV is gone.
	waitTVGone(t, hub, code)
	if c := tvRoom(t, open, "?code="+code+"&token=other"); c == code {
		t.Fatal("foreign token stole the code")
	}
	if c := tvRoom(t, open, "?code="+code); c == code {
		t.Fatal("anonymous TV stole a tokened code")
	}

	// Room swept (beyond the 2-min grace): code is reserved for the token for 7 days.
	hub.sweep(time.Now().Add(3 * time.Minute))
	hub.mu.Lock()
	_, live := hub.rooms[code]
	_, res := hub.reserved[code]
	hub.mu.Unlock()
	if live || !res {
		t.Fatalf("after sweep live=%v reserved=%v", live, res)
	}
	if c := tvRoom(t, open, "?code="+code+"&token=nope"); c == code {
		t.Fatal("reserved code handed to wrong token")
	}
	if c := tvRoom(t, open, "?code="+code+"&token=secret1"); c != code {
		t.Fatalf("reserved reclaim got %s want %s", c, code)
	}
}

func TestReservationExpires(t *testing.T) {
	_, hub := testServer(t)
	now := time.Now()
	hub.reserved["ABCD"] = reservation{token: hashToken("tok"), until: now.Add(time.Hour)}
	if rm := hub.claimRoom(&conn{done: make(chan struct{})}, "ABCD", hashToken("tok"), now); rm.Code != "ABCD" {
		t.Fatalf("got %s", rm.Code)
	}
	delete(hub.rooms, "ABCD")
	hub.reserved["ABCD"] = reservation{token: hashToken("tok"), until: now.Add(time.Hour)}
	hub.sweep(now.Add(2 * time.Hour))
	if len(hub.reserved) != 0 {
		t.Fatal("expired reservation not swept")
	}
	if rm := hub.claimRoom(&conn{done: make(chan struct{})}, "ABCD", hashToken("tok"), now.Add(2*time.Hour)); rm.Code == "ABCD" {
		t.Fatal("expired reservation reused")
	}
	// Random codes never collide with someone else's reservation.
	for i := 0; i < 50; i++ {
		hub.reserved[newCode()] = reservation{token: "x", until: now.Add(time.Hour)}
	}
	for i := 0; i < 50; i++ {
		rm := hub.claimRoom(&conn{done: make(chan struct{})}, "", "", now)
		if _, r := hub.reserved[rm.Code]; r {
			t.Fatal("got a reserved code")
		}
	}
}

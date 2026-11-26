package main

// Anonymous, short-lived browser presence. Game tabs POST a small heartbeat; no account,
// persistent identifier, IP address, seed, or player name is retained. This is deliberately
// separate from pairing WebSockets: a game tab and its phone are not two game sessions.

import (
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"sync"
	"time"
)

const (
	presenceTTL  = 50 * time.Second
	presenceBeat = 15 * time.Second
	activeWindow = 2 * time.Minute
	maxPresence  = 2000
)

var presenceID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

type presenceUpdate struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // web or tv (pads are observed on their WebSocket)
	Screen  string `json:"screen"`
	Mode    string `json:"mode"`
	Level   int    `json:"level"`
	Players int    `json:"players"`
	Room    string `json:"room"`
	IdleMS  int64  `json:"idleMs"`
	Gone    bool   `json:"gone"`
}

type presenceSession struct {
	id        string
	kind      string
	screen    string
	mode      string
	level     int
	players   int
	room      string
	idle      time.Duration
	external  bool
	connected time.Time
	seen      time.Time
}

type Presence struct {
	mu       sync.Mutex
	sessions map[string]*presenceSession
	unique   uint64
	games    uint64
	levels   uint64
	store    *statsStore
}

func NewPresence() *Presence { return &Presence{sessions: map[string]*presenceSession{}} }

// isExternal identifies traffic arriving through the Internet proxy without keeping its address.
// Direct VM/localhost sessions remain visible in a separate local count.
func isExternal(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("Forwarded") != "" {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate()
}

func validPresenceScreen(s string) bool { return validScreen(s) || s == "hidden" }

func (p *Presence) update(u presenceUpdate, external bool, now time.Time) bool {
	if !presenceID.MatchString(u.ID) || (u.Kind != "web" && u.Kind != "tv") || !validPresenceScreen(u.Screen) {
		return false
	}
	if u.Mode != "" && !validMode(u.Mode) {
		return false
	}
	if u.Players < 1 || u.Players > 2 || u.Level < 0 || u.Level > 100000 || u.IdleMS < 0 {
		return false
	}
	delta := lifetimeTotals{}
	p.mu.Lock()
	if u.Gone {
		delete(p.sessions, u.ID)
		p.mu.Unlock()
		return true
	}
	s := p.sessions[u.ID]
	if s == nil {
		if len(p.sessions) >= maxPresence {
			// Expire first; never let junk IDs grow the map without bound.
			for id, old := range p.sessions {
				if now.Sub(old.seen) > presenceTTL {
					delete(p.sessions, id)
				}
			}
			if len(p.sessions) >= maxPresence {
				p.mu.Unlock()
				return false
			}
		}
		s = &presenceSession{id: u.ID, connected: now}
		p.sessions[u.ID] = s
		p.unique++
		delta.Unique = 1
		if u.Screen == "play" {
			p.games++
			delta.Games = 1
		}
	} else {
		if s.screen != "play" && u.Screen == "play" {
			p.games++
			delta.Games = 1
		}
		if u.Screen == "play" && u.Level > s.level {
			n := uint64(u.Level - s.level)
			p.levels += n
			delta.Levels = n
		}
	}
	s.kind, s.screen, s.mode, s.level, s.players = u.Kind, u.Screen, u.Mode, u.Level, u.Players
	s.room, s.external, s.seen = u.Room, external, now
	s.idle = time.Duration(u.IdleMS) * time.Millisecond
	if s.idle > 365*24*time.Hour {
		s.idle = 365 * 24 * time.Hour
	}
	p.mu.Unlock()
	if p.store != nil && delta != (lifetimeTotals{}) {
		p.store.add(delta)
	}
	return true
}

func (p *Presence) expire(now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, s := range p.sessions {
		if now.Sub(s.seen) > presenceTTL {
			delete(p.sessions, id)
		}
	}
}

func (p *Presence) lifetime() (unique, games, levels uint64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.unique, p.games, p.levels
}

func (p *Presence) Handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	noCache(w)
	var u presenceUpdate
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if dec.Decode(&u) != nil || !p.update(u, isExternal(r), time.Now()) {
		http.Error(w, "invalid presence", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Pairing rooms: one TV per room, phones join as player 1/2 or spectators.
// See docs/overhaul/PROTOCOL.md.

const (
	codeAlphabet   = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no I, L, O, 0, 1
	codeLen        = 4
	maxRooms       = 500
	maxPads        = 8 // 2 players + spectators
	maxMsgBytes    = 4096
	sendBuf        = 128
	pingEvery      = 20 * time.Second
	tvGraceTimeout = 2 * time.Minute    // room kept this long after the TV disconnects
	reserveFor     = 7 * 24 * time.Hour // a token-owned code stays reserved this long after the room closes
	maxReserved    = 20000
)

var codeMiss = newLimiter(10, 30*time.Second)

// reservation: a closed room's code, kept for the TV that owned it (identified by a secret token).
type reservation struct {
	token string // sha256 hex of the TV token
	until time.Time
}

func hashToken(t string) string {
	if t == "" || len(t) > 128 {
		return ""
	}
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

type conn struct {
	ws   *websocket.Conn
	out  chan []byte
	slot int    // 0 = TV; 1,2 = players; 3+ = spectators
	id   string // client-chosen id for reconnects
	name string
	once sync.Once
	done chan struct{}
}

func newConn(ws *websocket.Conn) *conn {
	return &conn{ws: ws, out: make(chan []byte, sendBuf), done: make(chan struct{})}
}

// send never blocks; a client too slow to drain its buffer is dropped.
func (c *conn) send(b []byte) {
	select {
	case c.out <- b:
	default:
		c.close(websocket.StatusPolicyViolation, "slow consumer")
	}
}

func (c *conn) close(code websocket.StatusCode, why string) {
	c.once.Do(func() {
		close(c.done)
		go c.ws.Close(code, why)
	})
}

func (c *conn) writeLoop(ctx context.Context) {
	t := time.NewTicker(pingEvery)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case b := <-c.out:
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.ws.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.close(websocket.StatusGoingAway, "write failed")
				return
			}
		case <-t.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.ws.Ping(pctx)
			cancel()
			if err != nil {
				c.close(websocket.StatusGoingAway, "ping timeout")
				return
			}
		}
	}
}

type Room struct {
	Code   string
	mu     sync.Mutex
	tv     *conn
	tvLeft time.Time
	pads   map[int]*conn
	token  string // sha256 of the owning TV's token ("" = anonymous)
}

type Hub struct {
	mu       sync.Mutex
	rooms    map[string]*Room
	reserved map[string]reservation
	origins  []string
}

func NewHub(origins []string) *Hub {
	var o []string
	for _, s := range origins {
		if s = strings.TrimSpace(s); s != "" {
			o = append(o, s)
		}
	}
	return &Hub{rooms: map[string]*Room{}, reserved: map[string]reservation{}, origins: o}
}

func msg(v map[string]any) []byte { b, _ := json.Marshal(v); return b }

func newCode() string {
	var sb strings.Builder
	for i := 0; i < codeLen; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		sb.WriteByte(codeAlphabet[n.Int64()])
	}
	return sb.String()
}

func (h *Hub) accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(maxMsgBytes)
	return ws, nil
}

// HandleTV: /ws/tv[?code=ABCD][&token=SECRET] — creates a room, or reclaims one: an anonymous room whose TV
// dropped < 2 min ago, or (with the owning token) the same code for up to 7 days / replacing a stale TV conn.
func (h *Hub) HandleTV(w http.ResponseWriter, r *http.Request) {
	ws, err := h.accept(w, r)
	if err != nil {
		return
	}
	c := newConn(ws)
	q := r.URL.Query()
	room := h.claimRoom(c, strings.ToUpper(q.Get("code")), hashToken(q.Get("token")), time.Now())
	if room == nil {
		ws.Close(websocket.StatusTryAgainLater, "server full")
		return
	}

	ctx := r.Context()
	go c.writeLoop(ctx)
	room.mu.Lock()
	var players []map[string]any
	for s, p := range room.pads {
		players = append(players, map[string]any{"slot": s, "name": p.name})
	}
	room.mu.Unlock()
	c.send(msg(map[string]any{"t": "room", "code": room.Code, "pads": players}))
	room.broadcastPads(msg(map[string]any{"t": "tv", "up": true}))

	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			break
		}
		room.fromTV(c, data)
	}
	c.close(websocket.StatusNormalClosure, "")
	room.mu.Lock()
	if room.tv == c {
		room.tv = nil
		room.tvLeft = time.Now()
	}
	room.mu.Unlock()
	room.broadcastPads(msg(map[string]any{"t": "tv", "up": false}))
}

// claimRoom attaches TV conn c to a room (see HandleTV). Returns nil if the server is full.
func (h *Hub) claimRoom(c *conn, want, tok string, now time.Time) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old := h.rooms[want]; old != nil {
		old.mu.Lock()
		owner := tok != "" && old.token == tok
		var stale *conn
		if old.tv == nil && (old.token == "" || owner) {
			old.tv = c
		} else if old.tv != nil && owner { // same TV reconnecting before its old socket timed out
			stale, old.tv = old.tv, c
		}
		got := old.tv == c
		old.mu.Unlock()
		if stale != nil {
			stale.close(websocket.StatusNormalClosure, "replaced")
		}
		if got {
			return old
		}
	}
	if len(h.rooms) >= maxRooms {
		return nil
	}
	code := ""
	if res, ok := h.reserved[want]; ok && tok != "" && res.token == tok && now.Before(res.until) && h.rooms[want] == nil {
		code = want
	}
	for code == "" {
		if code = newCode(); h.rooms[code] != nil || h.isReserved(code, now) {
			code = ""
		}
	}
	delete(h.reserved, code)
	room := &Room{Code: code, tv: c, pads: map[int]*conn{}, token: tok}
	h.rooms[code] = room
	return room
}

// isReserved (h.mu held): code is held for some TV's token.
func (h *Hub) isReserved(code string, now time.Time) bool {
	res, ok := h.reserved[code]
	return ok && now.Before(res.until)
}

func (rm *Room) broadcastPads(b []byte) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for _, p := range rm.pads {
		p.send(b)
	}
}

// fromTV: {"to":0|1|2|..., "m":{...}} → m forwarded to that slot (0 = all pads). {"t":"ping"} → pong.
func (rm *Room) fromTV(c *conn, data []byte) {
	var env struct {
		T  string          `json:"t"`
		To int             `json:"to"`
		M  json.RawMessage `json:"m"`
	}
	if json.Unmarshal(data, &env) != nil {
		return
	}
	if env.T == "ping" {
		c.send(msg(map[string]any{"t": "pong"}))
		return
	}
	if env.T == "kick" {
		rm.mu.Lock()
		if p := rm.pads[env.To]; p != nil {
			p.close(websocket.StatusNormalClosure, "kicked")
		}
		rm.mu.Unlock()
		return
	}
	if len(env.M) == 0 {
		return
	}
	b := []byte(env.M)
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if env.To == 0 {
		for _, p := range rm.pads {
			p.send(b)
		}
	} else if p := rm.pads[env.To]; p != nil {
		p.send(b)
	}
}

// HandlePad: /ws/pad?code=ABCD[&slot=1|2|spec][&id=xyz][&name=Bob]
func (h *Hub) HandlePad(w http.ResponseWriter, r *http.Request) {
	ws, err := h.accept(w, r)
	if err != nil {
		return
	}
	q := r.URL.Query()
	fail := func(e string) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		ws.Write(ctx, websocket.MessageText, msg(map[string]any{"t": "error", "error": e}))
		cancel()
		ws.Close(websocket.StatusPolicyViolation, e)
	}
	h.mu.Lock()
	room := h.rooms[strings.ToUpper(strings.TrimSpace(q.Get("code")))]
	h.mu.Unlock()
	if room == nil {
		if !codeMiss.allow(clientIP(r)) {
			fail("rate_limited") // slows code guessing: ~10 misses, then 1 per 30 s
			return
		}
		fail("no_room")
		return
	}
	c := newConn(ws)
	c.id = q.Get("id")
	if len(c.id) > 64 {
		c.id = c.id[:64]
	}
	c.name = cleanName(q.Get("name"))
	want := q.Get("slot")

	room.mu.Lock()
	slot, e := room.pickSlot(want, c.id)
	if e != "" {
		room.mu.Unlock()
		fail(e)
		return
	}
	if old := room.pads[slot]; old != nil { // same id reconnecting: replace
		old.close(websocket.StatusNormalClosure, "replaced")
	}
	c.slot = slot
	room.pads[slot] = c
	tv := room.tv
	room.mu.Unlock()

	ctx := r.Context()
	go c.writeLoop(ctx)
	c.send(msg(map[string]any{"t": "joined", "code": room.Code, "slot": slot, "tv": tv != nil}))
	room.toTV(msg(map[string]any{"t": "join", "slot": slot, "name": c.name}))

	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			break
		}
		if strings.HasPrefix(string(data), `{"t":"ping"`) {
			c.send(msg(map[string]any{"t": "pong"}))
			continue
		}
		if !json.Valid(data) {
			continue
		}
		// wrap without re-encoding the payload
		b := make([]byte, 0, len(data)+24)
		b = append(b, `{"t":"pad","slot":`...)
		b = strconv.AppendInt(b, int64(slot), 10)
		b = append(b, `,"m":`...)
		b = append(b, data...)
		b = append(b, '}')
		room.toTV(b)
	}
	c.close(websocket.StatusNormalClosure, "")
	room.mu.Lock()
	gone := room.pads[slot] == c
	if gone {
		delete(room.pads, slot)
	}
	room.mu.Unlock()
	if gone {
		room.toTV(msg(map[string]any{"t": "leave", "slot": slot}))
	}
}

func (rm *Room) toTV(b []byte) {
	rm.mu.Lock()
	tv := rm.tv
	rm.mu.Unlock()
	if tv != nil {
		tv.send(b)
	}
}

// pickSlot (room.mu held). want: "1", "2", "spec" or "" (first free player slot, else spectator).
func (rm *Room) pickSlot(want, id string) (int, string) {
	if id != "" {
		for s, p := range rm.pads {
			if p.id == id && (want == "" || want == strconv.Itoa(s) || (want == "spec" && s > 2)) {
				return s, ""
			}
		}
	}
	free := func(s int) bool { return rm.pads[s] == nil }
	spec := func() (int, string) {
		if len(rm.pads) >= maxPads {
			return 0, "full"
		}
		for s := 3; ; s++ {
			if free(s) {
				return s, ""
			}
		}
	}
	switch want {
	case "1", "2":
		s, _ := strconv.Atoi(want)
		if !free(s) {
			return 0, "slot_taken"
		}
		return s, ""
	case "spec":
		return spec()
	default:
		for _, s := range []int{1, 2} {
			if free(s) {
				return s, ""
			}
		}
		return spec()
	}
}

// janitor removes rooms whose TV has been gone longer than the grace period.
func (h *Hub) janitor(every time.Duration) {
	for range time.Tick(every) {
		h.sweep(time.Now())
	}
}

func (h *Hub) sweep(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, rm := range h.rooms {
		rm.mu.Lock()
		if rm.tv == nil && now.Sub(rm.tvLeft) > tvGraceTimeout {
			for _, p := range rm.pads {
				p.close(websocket.StatusNormalClosure, "room closed")
			}
			delete(h.rooms, code)
			if rm.token != "" && len(h.reserved) < maxReserved {
				h.reserved[code] = reservation{token: rm.token, until: rm.tvLeft.Add(reserveFor)}
			}
		}
		rm.mu.Unlock()
	}
	for code, res := range h.reserved {
		if !now.Before(res.until) {
			delete(h.reserved, code)
		}
	}
}

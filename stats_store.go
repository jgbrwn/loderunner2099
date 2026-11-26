package main

// Small durable statistics store. Atomic renames make an interrupted deploy harmless: the
// previous valid snapshot remains. Only aggregate counters and five-minute activity samples
// are persisted; live session IDs, room codes, names, addresses and seeds never touch disk.

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	historyInterval = 5 * time.Minute
	historySpan     = 24 * time.Hour
	historyBuckets  = int(historySpan / historyInterval)
	statsVersion    = 1
)

type activityPoint struct {
	Time            time.Time `json:"time"`
	Internet        int       `json:"internetSessions"`
	ActivePlayers   int       `json:"activePlayers"`
	IdleConnections int       `json:"idleConnections"`
	Samples         int       `json:"samples,omitempty"`
}

type lifetimeTotals struct {
	Unique         uint64 `json:"uniqueSessions"`
	Games          uint64 `json:"gameStarts"`
	Levels         uint64 `json:"levelAdvances"`
	Rooms          uint64 `json:"roomsCreated"`
	TVConnections  uint64 `json:"tvConnections"`
	PadConnections uint64 `json:"padConnections"`
	TVMessages     uint64 `json:"tvMessages"`
	PadMessages    uint64 `json:"padMessages"`
	PadInputs      uint64 `json:"padInputs"`
}

type statsDisk struct {
	Version int             `json:"version"`
	Totals  lifetimeTotals  `json:"totals"`
	History []activityPoint `json:"history"`
}

type statsStore struct {
	mu       sync.Mutex
	path     string
	loaded   lifetimeTotals
	history  []activityPoint
	pending  lifetimeTotals
	dirty    bool
	closed   bool
	flushing bool
	stop     chan struct{}
	stopped  chan struct{}
	lastErr  string
	write    func(string, []byte) error
}

func newStatsStore(path string) *statsStore {
	s := &statsStore{path: path, write: atomicWriteFile}
	if path != "" {
		s.stop, s.stopped = make(chan struct{}), make(chan struct{})
		if data, err := os.ReadFile(path); err == nil {
			var disk statsDisk
			if json.Unmarshal(data, &disk) == nil && disk.Version == statsVersion {
				s.loaded, s.history = disk.Totals, cleanHistory(disk.History, time.Now())
			} else {
				log.Printf("stats: ignoring invalid history file %s", path)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			log.Printf("stats: cannot read %s: %v", path, err)
		}
		go s.flushLoop()
	}
	return s
}

func openStatsStore() *statsStore {
	path := os.Getenv("STATS_FILE")
	if path == "" {
		path = "/var/lib/loderunner2099/stats.json"
	}
	if path == "off" || path == "none" {
		return newStatsStore("")
	}
	return newStatsStore(path)
}

func atomicWriteFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".stats-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0o640); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func cleanHistory(points []activityPoint, now time.Time) []activityPoint {
	cutoff := now.Add(-historySpan)
	out := make([]activityPoint, 0, historyBuckets)
	for _, p := range points {
		if !p.Time.Before(cutoff) && !p.Time.After(now.Add(historyInterval)) && p.Internet >= 0 && p.ActivePlayers >= 0 && p.IdleConnections >= 0 {
			p.Time = p.Time.UTC().Truncate(historyInterval)
			out = append(out, p)
		}
	}
	return out
}

// load installs persisted lifetime totals exactly once. Later event deltas are added by add.
func (s *statsStore) load(h *Hub, p *Presence) {
	s.mu.Lock()
	totals, history := s.loaded, append([]activityPoint(nil), s.history...)
	s.mu.Unlock()
	h.mu.Lock()
	h.roomsCreated, h.tvConnections, h.padConnections = totals.Rooms, totals.TVConnections, totals.PadConnections
	h.tvMessages, h.padMessages, h.padInputs = totals.TVMessages, totals.PadMessages, totals.PadInputs
	h.mu.Unlock()
	p.mu.Lock()
	p.unique, p.games, p.levels = totals.Unique, totals.Games, totals.Levels
	p.mu.Unlock()
	// Make the first dashboard render useful even before the background sampler runs.
	s.mu.Lock()
	s.history = history
	s.mu.Unlock()
}

func (s *statsStore) totals(h *Hub, p *Presence) lifetimeTotals {
	u, g, l := p.lifetime()
	h.mu.Lock()
	defer h.mu.Unlock()
	return lifetimeTotals{Unique: u, Games: g, Levels: l, Rooms: h.roomsCreated,
		TVConnections: h.tvConnections, PadConnections: h.padConnections,
		TVMessages: h.tvMessages, PadMessages: h.padMessages, PadInputs: h.padInputs}
}

func (s *statsStore) add(delta lifetimeTotals) {
	s.mu.Lock()
	s.pending = addTotals(s.pending, delta)
	s.dirty = s.dirty || delta != (lifetimeTotals{})
	s.mu.Unlock()
}

func addTotals(a, b lifetimeTotals) lifetimeTotals {
	return lifetimeTotals{Unique: a.Unique + b.Unique, Games: a.Games + b.Games, Levels: a.Levels + b.Levels,
		Rooms: a.Rooms + b.Rooms, TVConnections: a.TVConnections + b.TVConnections,
		PadConnections: a.PadConnections + b.PadConnections, TVMessages: a.TVMessages + b.TVMessages,
		PadMessages: a.PadMessages + b.PadMessages, PadInputs: a.PadInputs + b.PadInputs}
}

func (s *statsStore) markDirty() { s.mu.Lock(); s.dirty = true; s.mu.Unlock() }

func (s *statsStore) healthy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.path != "" && s.lastErr == ""
}

// record averages all samples in a five-minute bucket. If the server was down, no synthetic
// samples are invented: the chart shows a gap at that bucket.
func (s *statsStore) record(point activityPoint, now time.Time) {
	point.Time = now.UTC().Truncate(historyInterval)
	point.Samples = 1
	s.mu.Lock()
	if n := len(s.history); n > 0 && s.history[n-1].Time.Equal(point.Time) {
		old := &s.history[n-1]
		n := old.Samples
		if n < 1 {
			n = 1
		}
		old.Internet = (old.Internet*n + point.Internet) / (n + 1)
		old.ActivePlayers = (old.ActivePlayers*n + point.ActivePlayers) / (n + 1)
		old.IdleConnections = (old.IdleConnections*n + point.IdleConnections) / (n + 1)
		old.Samples = n + 1
	} else {
		s.history = append(s.history, point)
	}
	s.history = cleanHistory(s.history, now)
	s.dirty = true
	s.mu.Unlock()
}

func (s *statsStore) graph(now time.Time) []activityPoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	points := cleanHistory(s.history, now)
	if points == nil {
		return []activityPoint{}
	}
	return append([]activityPoint(nil), points...)
}

func (s *statsStore) flushLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer close(s.stopped)
	for {
		select {
		case <-ticker.C:
			s.mu.Lock()
			dirty := s.dirty
			s.mu.Unlock()
			if dirty {
				s.flush()
			}
		case <-s.stop:
			return
		}
	}
}

func (s *statsStore) flush() {
	s.mu.Lock()
	if s.path == "" || s.flushing {
		s.mu.Unlock()
		return
	}
	s.flushing = true
	// Counters have already been applied to the in-memory totals. Capture current totals
	// outside this lock at the sampler, and add only the pending deltas to the loaded base.
	previous, pending := s.loaded, s.pending
	s.loaded = addTotals(s.loaded, s.pending)
	s.pending = lifetimeTotals{}
	disk := statsDisk{Version: statsVersion, Totals: s.loaded, History: append([]activityPoint(nil), s.history...)}
	s.dirty = false
	write, path := s.write, s.path
	s.mu.Unlock()
	data, err := json.Marshal(disk)
	if err == nil {
		err = write(path, data)
	}
	s.mu.Lock()
	s.flushing = false
	if err != nil {
		s.lastErr = err.Error()
		// The write may have been interrupted: do not discard deltas. A later flush
		// must not multiply totals when it retries.
		s.loaded = previous
		s.pending = addTotals(s.pending, pending)
	} else {
		s.lastErr = ""
	}
	s.dirty = s.dirty || err != nil
	s.mu.Unlock()
	if err != nil {
		log.Printf("stats: save failed: %v", err)
	}
}

// close flushes synchronously and stops the background writer. Production counters are also
// checkpointed every 15 seconds, bounding loss during a SIGKILL or host failure.
func (s *statsStore) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	stop, stopped, path := s.stop, s.stopped, s.path
	s.mu.Unlock()
	if path != "" {
		s.flush()
		close(stop)
		<-stopped
	}
}

package main

// Owner-only operations dashboard on an alternate authenticated proxy port. It is never
// mounted on the public game listener. Aggregate history survives service restarts.

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"
	"time"
)

var statsRequests atomic.Uint64
var statsPage = template.Must(template.New("stats").Funcs(template.FuncMap{
	"dur":   duration,
	"bytes": bytes,
	"short": func(s string) string {
		if len(s) > 10 {
			return s[:6] + "…" + s[len(s)-3:]
		}
		return s
	},
}).Parse(statsHTML))

type statsSession struct {
	ID          string        `json:"id"`
	Kind        string        `json:"kind"`
	Screen      string        `json:"screen"`
	Mode        string        `json:"mode,omitempty"`
	Level       int           `json:"level,omitempty"`
	Players     int           `json:"players"`
	Room        string        `json:"room,omitempty"`
	External    bool          `json:"external"`
	Idle        bool          `json:"idle"`
	IdleFor     time.Duration `json:"-"`
	IdleMS      int64         `json:"idleMs"`
	Connected   time.Duration `json:"-"`
	Age         time.Duration `json:"-"`
	LastInput   time.Duration `json:"-"`
	ConnectedMS int64         `json:"connectedMs"`
	AgeMS       int64         `json:"ageMs"`
	LastInputMS int64         `json:"lastInputMs,omitempty"`
	Inputs      uint64        `json:"inputs,omitempty"`
	Messages    uint64        `json:"messages,omitempty"`
	Name        string        `json:"name,omitempty"`
	Slot        int           `json:"slot,omitempty"`
	TV          bool          `json:"tvOnline,omitempty"`
}

type statsRoom struct {
	Code     string        `json:"code"`
	Screen   string        `json:"screen"`
	Mode     string        `json:"mode,omitempty"`
	Level    int           `json:"level,omitempty"`
	TV       bool          `json:"tvOnline"`
	Players  int           `json:"players"`
	Watching int           `json:"spectators"`
	Age      time.Duration `json:"-"`
	AgeMS    int64         `json:"ageMs"`
}

type statsMode struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type statsSnapshot struct {
	Generated       time.Time       `json:"generatedAt"`
	Started         time.Time       `json:"startedAt"`
	Uptime          time.Duration   `json:"-"`
	UptimeMS        int64           `json:"uptimeMs"`
	GoVersion       string          `json:"goVersion"`
	Goroutines      int             `json:"goroutines"`
	HeapBytes       uint64          `json:"heapBytes"`
	SysBytes        uint64          `json:"sysBytes"`
	GCRuns          uint32          `json:"gcRuns"`
	ExternalNow     int             `json:"externalNow"`
	LocalNow        int             `json:"localNow"`
	PlayingNow      int             `json:"playingNow"`
	IdleNow         int             `json:"idleNow"`
	HiddenNow       int             `json:"hiddenNow"`
	WebNow          int             `json:"webNow"`
	TVNow           int             `json:"tvNow"`
	PlayerSeats     int             `json:"estimatedPlayerSeats"`
	ActiveSeats     int             `json:"activePlayerSeats"`
	Modes           []statsMode     `json:"modes"`
	Sessions        []statsSession  `json:"sessions"`
	UniqueTotal     uint64          `json:"uniqueSessionsTotal"`
	GamesTotal      uint64          `json:"gameStartsTotal"`
	LevelsTotal     uint64          `json:"levelAdvancesTotal"`
	RoomsNow        int             `json:"roomsNow"`
	RoomsOnline     int             `json:"roomsOnline"`
	Rooms           []statsRoom     `json:"rooms"`
	ReservedCodes   int             `json:"reservedCodes"`
	PadsNow         int             `json:"padsNow"`
	PadsActive      int             `json:"padsActive"`
	PadsIdle        int             `json:"padsIdle"`
	Pads            []statsSession  `json:"pads"`
	RoomsTotal      uint64          `json:"roomsTotal"`
	TVTotal         uint64          `json:"tvConnectionsTotal"`
	PadTotal        uint64          `json:"padConnectionsTotal"`
	TVMessages      uint64          `json:"tvMessagesTotal"`
	PadMessages     uint64          `json:"padMessagesTotal"`
	PadInputs       uint64          `json:"padInputsTotal"`
	StatsRequests   uint64          `json:"statsRequestsTotal"`
	ActiveWindow    string          `json:"activeWindow"`
	PresenceTTL     string          `json:"presenceTTL"`
	History         []activityPoint `json:"history24h"`
	HistoryJSON     template.JS     `json:"-"`
	ExternalPlaying int             `json:"externalPlayingNow"`
	ExternalIdle    int             `json:"externalIdleNow"`
	Persistent      bool            `json:"persistentTotals"`
}

func duration(n time.Duration) string {
	if n < 0 {
		n = 0
	}
	if n < time.Minute {
		return fmt.Sprintf("%ds", int(n.Seconds()))
	}
	if n < time.Hour {
		return fmt.Sprintf("%dm %02ds", int(n.Minutes()), int(n.Seconds())%60)
	}
	if n < 24*time.Hour {
		return fmt.Sprintf("%dh %02dm", int(n.Hours()), int(n.Minutes())%60)
	}
	return fmt.Sprintf("%dd %dh", int(n.Hours()/24), int(n.Hours())%24)
}
func bytes(n uint64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := uint64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}
func (h *Hub) stats(p *Presence, now time.Time) statsSnapshot {
	s := statsSnapshot{Generated: now, Started: h.started, Uptime: now.Sub(h.started), GoVersion: runtime.Version(),
		Goroutines: runtime.NumGoroutine(), ActiveWindow: duration(activeWindow), PresenceTTL: duration(presenceTTL),
		StatsRequests: statsRequests.Load(), UptimeMS: now.Sub(h.started).Milliseconds()}
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	s.HeapBytes, s.SysBytes, s.GCRuns = mem.HeapAlloc, mem.Sys, mem.NumGC
	s.UniqueTotal, s.GamesTotal, s.LevelsTotal = p.lifetime()
	modeCount := map[string]int{}
	p.mu.Lock()
	for id, v := range p.sessions {
		if now.Sub(v.seen) > presenceTTL {
			continue
		}
		idleFor := v.idle + now.Sub(v.seen)
		idle := v.screen != "play" || idleFor >= activeWindow
		x := statsSession{ID: id, Kind: v.kind, Screen: v.screen, Mode: v.mode, Level: v.level, Players: v.players,
			Room: v.room, External: v.external, Idle: idle, IdleFor: idleFor, Connected: now.Sub(v.connected), Age: now.Sub(v.seen)}
		x.IdleMS, x.ConnectedMS, x.AgeMS = x.IdleFor.Milliseconds(), x.Connected.Milliseconds(), x.Age.Milliseconds()
		s.Sessions = append(s.Sessions, x)
		if v.external {
			s.ExternalNow++
		} else {
			s.LocalNow++
		}
		if v.kind == "tv" {
			s.TVNow++
		} else {
			s.WebNow++
		}
		if v.screen == "play" {
			s.PlayerSeats += v.players
			if !idle {
				s.PlayingNow++
				s.ActiveSeats += v.players
				if v.external {
					s.ExternalPlaying += v.players
				}
			} else {
				s.IdleNow++
			}
			if v.mode != "" {
				modeCount[v.mode]++
			}
		} else if v.screen == "hidden" {
			s.HiddenNow++
		} else {
			s.IdleNow++
		}
		if v.external && idle {
			s.ExternalIdle++
		}
	}
	p.mu.Unlock()
	for _, name := range []string{"single", "coop", "versus"} {
		s.Modes = append(s.Modes, statsMode{name, modeCount[name]})
	}
	sort.Slice(s.Sessions, func(i, j int) bool {
		if s.Sessions[i].External != s.Sessions[j].External {
			return s.Sessions[i].External
		}
		return s.Sessions[i].Connected > s.Sessions[j].Connected
	})
	h.mu.Lock()
	s.RoomsTotal, s.TVTotal, s.PadTotal = h.roomsCreated, h.tvConnections, h.padConnections
	s.TVMessages, s.PadMessages, s.PadInputs = h.tvMessages, h.padMessages, h.padInputs
	s.ReservedCodes = len(h.reserved)
	for code, rm := range h.rooms {
		rm.mu.Lock()
		r := statsRoom{Code: code, Screen: rm.state.screen, Mode: rm.state.mode, Level: rm.state.level, TV: rm.tv != nil, Age: now.Sub(rm.createdAt)}
		if rm.tv != nil {
			s.RoomsOnline++
		}
		for slot, c := range rm.pads {
			lastInput := now.Sub(c.connectedAt)
			if !c.lastInput.IsZero() {
				lastInput = now.Sub(c.lastInput)
			}
			idle := lastInput >= activeWindow
			s.PadsNow++
			if idle {
				s.PadsIdle++
			} else {
				s.PadsActive++
			}
			if slot <= 2 {
				r.Players++
			} else {
				r.Watching++
			}
			pad := statsSession{ID: fmt.Sprintf("%s/%d", code, slot), Kind: "pad", Screen: rm.state.screen,
				Room: code, Name: c.name, Slot: slot, TV: rm.tv != nil, Idle: idle, IdleFor: lastInput,
				Connected: now.Sub(c.connectedAt), LastInput: lastInput, Inputs: c.inputs, Messages: c.messages,
				External: !isLocalAddr(c.remoteAddr)}
			pad.IdleMS, pad.ConnectedMS, pad.LastInputMS = pad.IdleFor.Milliseconds(), pad.Connected.Milliseconds(), pad.LastInput.Milliseconds()
			if pad.External {
				if idle {
					s.ExternalIdle++
				} else if slot <= 2 {
					s.ExternalPlaying++
				}
			}
			s.Pads = append(s.Pads, pad)
		}
		r.AgeMS = r.Age.Milliseconds()
		s.Rooms = append(s.Rooms, r)
		rm.mu.Unlock()
	}
	s.RoomsNow = len(h.rooms)
	h.mu.Unlock()
	sort.Slice(s.Rooms, func(i, j int) bool { return s.Rooms[i].Code < s.Rooms[j].Code })
	sort.Slice(s.Pads, func(i, j int) bool { return s.Pads[i].ID < s.Pads[j].ID })
	if p.store != nil {
		s.History = p.store.graph(now)
		s.Persistent = p.store.healthy()
		if data, err := json.Marshal(s.History); err == nil {
			s.HistoryJSON = template.JS(data)
		}
	}
	return s
}

func isLocalAddr(host string) bool {
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func sampleStats(h *Hub, p *Presence, now time.Time) {
	p.expire(now)
	s := h.stats(p, now)
	if p.store != nil {
		p.store.record(activityPoint{Internet: s.ExternalNow, ActivePlayers: s.ExternalPlaying, IdleConnections: s.ExternalIdle}, now)
	}
}

func statsMux(h *Hub, p *Presence) http.Handler {
	mux := http.NewServeMux()
	handler := func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/stats" && r.URL.Path != "/stats/" {
			http.NotFound(w, r)
			return
		}
		statsRequests.Add(1)
		sampleStats(h, p, time.Now())
		noCache(w)
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		s := h.stats(p, time.Now())
		if r.URL.Query().Get("format") == "json" || r.URL.Query().Has("json") || strings.Contains(r.Header.Get("Accept"), "application/json") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			enc := json.NewEncoder(w)
			enc.SetIndent("", "  ")
			_ = enc.Encode(s)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := statsPage.Execute(w, s); err != nil {
			return
		}
	}
	mux.HandleFunc("/stats", handler)
	mux.HandleFunc("/stats/", handler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/stats", http.StatusTemporaryRedirect)
	})
	return mux
}

const statsHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LODE RUNNER 2099 · Operations</title>
<style>
:root{color-scheme:dark;--bg:#070512;--panel:#0e0b20;--line:#252044;--text:#eeeaff;--muted:#9690b5;--cyan:#42f5e9;--pink:#ff5bc8;--green:#72f1a7;--amber:#ffd166}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 70% -20%,#222052 0,transparent 48%),var(--bg);color:var(--text);font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
main{max-width:1440px;margin:auto;padding:34px 28px 50px}header{display:flex;justify-content:space-between;align-items:end;gap:20px;border-bottom:1px solid var(--line);padding-bottom:22px}
eyebrow,.eyebrow{color:var(--cyan);font-size:11px;letter-spacing:.22em;text-transform:uppercase}h1{font-size:clamp(24px,4vw,42px);letter-spacing:.05em;margin:5px 0 0;font-weight:500}h1 b{color:var(--pink);font-weight:500}.live{display:flex;align-items:center;gap:9px;color:var(--green);white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green)}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}.toolbar{display:flex;gap:22px;align-items:center;margin:20px 0;color:var(--muted);font-size:12px}.toolbar button{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:7px 12px;border-radius:5px;font:inherit;cursor:pointer}.toolbar button:hover{border-color:var(--cyan)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:linear-gradient(140deg,#14102b,var(--panel));border:1px solid var(--line);border-radius:10px;padding:19px 20px;min-height:118px}.label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.13em}.value{font-size:38px;line-height:1.2;margin:10px 0 3px;color:var(--cyan);font-variant-numeric:tabular-nums}.value.pink{color:var(--pink)}.value.green{color:var(--green)}.sub{font-size:11px;color:var(--muted)}
section{margin-top:28px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.15em;font-weight:500;margin:0 0 12px;color:#c8c1e8}h2 span{color:var(--muted);font-size:11px;letter-spacing:0;text-transform:none;margin-left:10px}
.tablewrap{overflow:auto;border:1px solid var(--line);border-radius:9px;background:#0b0818}table{width:100%;border-collapse:collapse;white-space:nowrap}th{text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:400;padding:12px 15px;background:#110d23}td{padding:12px 15px;border-top:1px solid #1c1732;font-size:12px}tr:hover td{background:#13102a}.tag{display:inline-block;border:1px solid #3a3260;border-radius:4px;padding:1px 6px;font-size:10px;text-transform:uppercase;color:#c4b9ed}.tag.play{color:var(--green);border-color:#28684c}.tag.idle{color:var(--amber);border-color:#635329}.tag.tv{color:var(--cyan)}.tag.pad{color:var(--pink)}.empty{padding:25px;text-align:center;color:var(--muted)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}.facts{display:grid;grid-template-columns:1fr 1fr;gap:0 25px}.fact{display:flex;justify-content:space-between;gap:15px;padding:9px 0;border-bottom:1px solid #1c1732}.fact span{color:var(--muted)}.fact b{font-weight:400;text-align:right}.meter{height:5px;background:#211b3b;border-radius:4px;margin-top:10px;overflow:hidden}.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--pink))}
.chartcard{border:1px solid var(--line);border-radius:10px;background:linear-gradient(150deg,#14102b,#0b0818);padding:20px 20px 12px}.chartlegend{display:flex;gap:25px;flex-wrap:wrap;color:var(--muted);font-size:11px;margin-bottom:16px}.chartlegend span{display:flex;align-items:center;gap:7px}.chartlegend i{width:18px;height:3px;border-radius:2px}.chartlegend b{color:var(--text);font-weight:400;margin-left:4px}.chartlegend svg{overflow:visible}#activityChart{height:270px;position:relative}#activityChart svg{width:100%;height:100%;display:block;overflow:visible}.chartaxis{display:flex;justify-content:space-between;color:var(--muted);font-size:10px;padding:5px 0 0 40px}.charttip{position:fixed;z-index:10;pointer-events:none;background:#191330;border:1px solid #44376e;border-radius:6px;padding:10px 12px;font-size:11px;box-shadow:0 8px 25px #0008;white-space:nowrap}.chartempty{height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)}
footer{color:var(--muted);font-size:11px;margin-top:28px;border-top:1px solid var(--line);padding-top:20px;line-height:1.8}.note{max-width:850px}.danger{color:var(--amber)}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}main{padding:22px 16px}header{align-items:start;flex-direction:column}.toolbar{flex-wrap:wrap;gap:12px}}@media(max-width:430px){.grid{gap:9px}.card{padding:14px;min-height:105px}.value{font-size:29px}}
</style></head><body><main>
<header><div><div class="eyebrow">Private operations / live telemetry</div><h1>LODE RUNNER <b>2099</b></h1></div><div class="live"><i class="dot"></i>SERVER ONLINE</div></header>
<div class="toolbar"><button id="refresh">↻ Refresh</button><a href="?format=json">JSON ↗</a><span>Generated {{.Generated.Format "2006-01-02 15:04:05 MST"}}</span><span id="auto"></span></div>
<div class="grid">
<div class="card"><div class="label">Internet sessions now</div><div class="value">{{.ExternalNow}}</div><div class="sub">{{.LocalNow}} local / development · {{len .Sessions}} total</div></div>
<div class="card"><div class="label">Actively playing</div><div class="value green">{{.PlayingNow}}</div><div class="sub">{{.ActiveSeats}} estimated active player seats</div></div>
<div class="card"><div class="label">Connected, not active</div><div class="value pink">{{.IdleNow}}</div><div class="sub">menu, pause, idle screen, hidden or inactive</div></div>
<div class="card"><div class="label">Player seats</div><div class="value">{{.PlayerSeats}}</div><div class="sub">estimated from current game sessions</div></div>
</div>
<section><h2>Internet activity · last 24 hours <span>five-minute averages · downtime appears as a gap</span></h2>
<div class="chartcard"><div class="chartlegend"><span><i style="background:var(--cyan)"></i>Internet sessions <b id="nowInternet">{{.ExternalNow}}</b></span><span><i style="background:var(--green)"></i>Active players <b id="nowActive">{{.ExternalPlaying}}</b></span><span><i style="background:var(--pink)"></i>Idle connections <b id="nowIdle">{{.ExternalIdle}}</b></span></div>
<div id="activityChart" role="img" aria-label="24-hour line graph of Internet sessions, active players and idle connections"></div><div class="chartaxis"><span id="chartStart">−24h</span><span>Time (<span id="timezone"></span>)</span><span>Now</span></div><div id="chartTip" class="charttip" hidden></div></div></section>
<section><h2>Game sessions <span>heartbeats expire after {{.PresenceTTL}} · active means playing + input within {{.ActiveWindow}}</span></h2>
<div class="tablewrap"><table><thead><tr><th>Origin</th><th>Client</th><th>Status</th><th>Mode</th><th>Level</th><th>Seats</th><th>Room</th><th>Connected</th><th>Idle for</th><th>Session</th></tr></thead><tbody>
{{range .Sessions}}<tr><td>{{if .External}}<span class="tag play">Internet</span>{{else}}<span class="tag">Local</span>{{end}}</td><td><span class="tag {{.Kind}}">{{.Kind}}</span></td><td><span class="tag {{if .Idle}}idle{{else}}play{{end}}">{{.Screen}}</span></td><td>{{or .Mode "—"}}</td><td>{{if .Level}}{{.Level}}{{else}}—{{end}}</td><td>{{.Players}}</td><td>{{or .Room "—"}}</td><td>{{dur .Connected}}</td><td>{{dur .IdleFor}}</td><td title="{{.ID}}">{{short .ID}}</td></tr>{{else}}<tr><td colspan="10" class="empty">No browser sessions reporting right now.</td></tr>{{end}}
</tbody></table></div></section>
<section><h2>Current modes</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)">{{range .Modes}}<div class="card" style="min-height:90px"><div class="label">{{.Name}}</div><div class="value" style="font-size:28px">{{.Count}}</div></div>{{end}}</div></section>
<section class="cols"><div><h2>Pairing rooms <span>{{.RoomsOnline}} TVs online / {{.RoomsNow}} rooms</span></h2><div class="tablewrap"><table><thead><tr><th>Code</th><th>TV</th><th>State</th><th>Mode / level</th><th>P1/P2</th><th>Watching</th><th>Age</th></tr></thead><tbody>{{range .Rooms}}<tr><td><b>{{.Code}}</b></td><td>{{if .TV}}<span class="tag play">online</span>{{else}}<span class="tag idle">grace</span>{{end}}</td><td>{{or .Screen "unknown"}}</td><td>{{or .Mode "—"}} {{if .Level}}/ {{.Level}}{{end}}</td><td>{{.Players}}</td><td>{{.Watching}}</td><td>{{dur .Age}}</td></tr>{{else}}<tr><td colspan="7" class="empty">No active pairing rooms.</td></tr>{{end}}</tbody></table></div></div>
<div><h2>Phone / desktop controllers <span>{{.PadsActive}} active · {{.PadsIdle}} inactive</span></h2><div class="tablewrap"><table><thead><tr><th>Controller</th><th>Room</th><th>State</th><th>Last input</th><th>Inputs</th><th>Connected</th></tr></thead><tbody>{{range .Pads}}<tr><td>{{if .Name}}{{.Name}}{{else}}Slot {{.Slot}}{{end}}</td><td>{{.Room}}</td><td><span class="tag {{if .Idle}}idle{{else}}play{{end}}">{{if .Idle}}inactive{{else}}active{{end}}</span></td><td>{{dur .LastInput}}</td><td>{{.Inputs}}</td><td>{{dur .Connected}}</td></tr>{{else}}<tr><td colspan="6" class="empty">No controllers connected.</td></tr>{{end}}</tbody></table></div></div></section>
<section class="cols"><div><h2>Server health</h2><div class="card facts"><div class="fact"><span>Uptime</span><b>{{dur .Uptime}}</b></div><div class="fact"><span>Started</span><b>{{.Started.Format "Jan 02 15:04 MST"}}</b></div><div class="fact"><span>Go runtime</span><b>{{.GoVersion}}</b></div><div class="fact"><span>Goroutines</span><b>{{.Goroutines}}</b></div><div class="fact"><span>Heap allocated</span><b>{{bytes .HeapBytes}}</b></div><div class="fact"><span>Memory from OS</span><b>{{bytes .SysBytes}}</b></div><div class="fact"><span>GC runs</span><b>{{.GCRuns}}</b></div><div class="fact"><span>Dashboard requests</span><b>{{.StatsRequests}}</b></div></div></div>
<div><h2>Lifetime totals <span>{{if .Persistent}}survive restarts{{else}}persistence unavailable — check server logs{{end}}</span></h2><div class="card facts"><div class="fact"><span>Unique browser sessions</span><b>{{.UniqueTotal}}</b></div><div class="fact"><span>Game starts</span><b>{{.GamesTotal}}</b></div><div class="fact"><span>Level advances</span><b>{{.LevelsTotal}}</b></div><div class="fact"><span>Rooms created</span><b>{{.RoomsTotal}}</b></div><div class="fact"><span>TV connections</span><b>{{.TVTotal}}</b></div><div class="fact"><span>Pad connections</span><b>{{.PadTotal}}</b></div><div class="fact"><span>TV / pad messages</span><b>{{.TVMessages}} / {{.PadMessages}}</b></div><div class="fact"><span>Real pad inputs</span><b>{{.PadInputs}}</b></div></div></div></section>
<footer><div class="note"><b>How to read this:</b> “Internet sessions” are browser game tabs arriving through the external proxy, not unique people. “Actively playing” means a visible, unpaused game with input in the last {{.ActiveWindow}}; hidden tabs and menus count as connected but not active. Player seats are estimates: the server cannot distinguish two people sharing one keyboard. Controllers are listed separately and never added to game-session totals.</div>
<div>Lifetime totals and aggregate 24-hour history are saved locally and survive server restarts. No IP addresses, session IDs, names from game sessions, seeds, or payloads are persisted. Controller display names are limited to the existing pairing names. Reserved pairing codes: {{.ReservedCodes}}.</div></footer>
</main><script>
const HISTORY={{if .HistoryJSON}}{{.HistoryJSON}}{{else}}[]{{end}};
const NOW={{.Generated.UnixMilli}};
const chart=document.getElementById('activityChart'),tip=document.getElementById('chartTip');
document.getElementById('timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function drawHistory(){
 const w=Math.max(320,chart.clientWidth),h=Math.max(220,chart.clientHeight),left=44,right=12,top=14,bottom=25,iw=w-left-right,ih=h-top-bottom;
 const start=NOW-86400000,end=NOW,points=HISTORY.filter(p=>new Date(p.time).getTime()>=start-300000);
 const max=Math.max(1,...points.map(p=>Math.max(p.internetSessions,p.activePlayers,p.idleConnections)));
 const x=t=>left+(t-start)/(end-start)*iw,y=v=>top+ih-v/max*ih;
 let svg='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-hidden="true">';
 for(let i=0;i<=4;i++){const v=Math.round(max*i/4),yy=y(v);svg+='<line x1="'+left+'" x2="'+(w-right)+'" y1="'+yy+'" y2="'+yy+'" stroke="#29223f" stroke-width="1"/><text x="'+(left-9)+'" y="'+(yy+4)+'" fill="#9690b5" font-size="10" text-anchor="end">'+v+'</text>'}
 for(let i=0;i<=6;i++){const xx=left+iw*i/6;svg+='<line x1="'+xx+'" x2="'+xx+'" y1="'+top+'" y2="'+(top+ih)+'" stroke="#1b162e"/>'}
 const series=[['internetSessions','#42f5e9'],['activePlayers','#72f1a7'],['idleConnections','#ff5bc8']];
 const paths=[];
 for(const [key,color] of series){let d='',open=false;const coords=[];
  for(const p of points){const t=new Date(p.time).getTime();if(t<start||t>end)continue;const xx=x(t),yy=y(p[key]);coords.push({p,x:xx,y:yy});d+=(open?'L':'M')+xx.toFixed(2)+','+yy.toFixed(2)+' ';open=true}
  if(d)svg+='<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>';
  paths.push({key,color,coords});
 }
 // A small dot makes an isolated sample visible without inventing a line across downtime.
 for(const s of paths)if(s.coords.length===1){const p=s.coords[0];svg+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3" fill="'+s.color+'"/>'}
 svg+='</svg>';chart.innerHTML=points.length?svg:'<div class="chartempty">Collecting activity… the first five-minute sample will appear shortly.</div>';
 if(points.length){const hit=document.createElement('div');hit.style.cssText='position:absolute;inset:0';chart.appendChild(hit);
  hit.onmousemove=e=>{const r=chart.getBoundingClientRect(),mouseTime=start+(e.clientX-r.left-left)/iw*(end-start);let nearest=null,dist=Infinity;
   for(const p of points){const d=Math.abs(new Date(p.time).getTime()-mouseTime);if(d<dist){nearest=p;dist=d}}
   if(!nearest)return;const d=new Date(nearest.time);tip.hidden=false;tip.innerHTML='<b>'+esc(d.toLocaleString())+'</b><br><span style="color:#42f5e9">●</span> Internet sessions: '+nearest.internetSessions+'<br><span style="color:#72f1a7">●</span> Active players: '+nearest.activePlayers+'<br><span style="color:#ff5bc8">●</span> Idle connections: '+nearest.idleConnections;
   tip.style.left=Math.min(innerWidth-240,e.clientX+16)+'px';tip.style.top=Math.max(8,e.clientY-90)+'px'};
  hit.onmouseleave=()=>tip.hidden=true;
 }
}
drawHistory();let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(drawHistory,150)});
const b=document.getElementById('refresh');b.onclick=()=>location.reload();let auto=false,t;
document.getElementById('auto').innerHTML='<button id="toggle">Auto-refresh: off</button>';
document.getElementById('toggle').onclick=()=>{auto=!auto;document.getElementById('toggle').textContent='Auto-refresh: '+(auto?'10s':'off');clearInterval(t);if(auto)t=setInterval(()=>location.reload(),10000)};
</script></body></html>`

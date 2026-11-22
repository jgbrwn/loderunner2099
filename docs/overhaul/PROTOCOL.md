# TV ↔ phone pairing protocol (WebSocket, JSON text frames)

Same-origin only (`ALLOWED_ORIGINS` env = extra comma-separated host patterns). Max frame 4 KB.
Server pings every 20 s (WS ping frames, browsers answer automatically). Either side may send `{"t":"ping"}` →
server replies `{"t":"pong"}` (use for RTT / keepalive). Reconnect with backoff on close.

## TV: `wss://HOST/ws/tv[?code=ABCD]`
Pass `code` (from a previous session, e.g. sessionStorage) to reclaim the room if its TV dropped < 2 min ago;
otherwise a new room is made. Room codes: 4 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (case-insensitive).

Server → TV:
- `{"t":"room","code":"ABCD","pads":[{"slot":1,"name":"Ann"}]}` — first message; pads = already-connected phones.
  QR: `/api/qr?text=` + encodeURIComponent(`https://HOST/pad?code=ABCD`).
- `{"t":"join","slot":1,"name":"Ann"}` / `{"t":"leave","slot":1}`
- `{"t":"pad","slot":1,"m":{...}}` — a phone's message, verbatim in `m`.

TV → server:
- `{"to":N,"m":{...}}` — relay `m` verbatim to slot N (`0` = all phones).
- `{"t":"kick","to":N}` — disconnect a phone.

## Phone: `wss://HOST/ws/pad?code=ABCD[&slot=1|2|spec][&id=CLIENTID][&name=NAME]`
No `slot` → first free of 1, 2, else spectator (slots 3+; max 8 phones). `id` = random id kept in localStorage;
reconnecting with the same id reclaims the same slot. `name` ≤ 24 chars.

Server → phone:
- `{"t":"joined","code":"ABCD","slot":1,"tv":true}`
- `{"t":"error","error":"no_room"|"slot_taken"|"full"}` then close.
- `{"t":"tv","up":false|true}` — TV dropped / came back.
- anything the TV relays (`m` objects, see below).

Phone → server: any JSON object → delivered to the TV as `{"t":"pad","slot":N,"m":<object>}`.

## App-level messages (inside `m`; the server doesn't inspect them)
Phone → TV:
- `{"t":"in","b":BITS}` — full button state, sent on every change (+ every 1 s as keepalive). Bits:
  1 left, 2 right, 4 up, 8 down, 16 digLeft, 32 digRight, 64 pause, 128 back, 256 confirm.
- `{"t":"menu","a":"pause"|"resume"|"restart"|"quit"}` — optional explicit actions.

TV → phone:
- `{"t":"state","screen":"menu"|"play"|"pause"|"over"|"idle","mode":"single"|"coop"|"versus","level":3,
  "lives":4,"score":1250,"gold":[2,9]}` — on change; pad UI adapts (e.g. hide dig buttons in menus).
- `{"t":"rumble","ms":80}` (navigator.vibrate), `{"t":"event","e":"gold"|"death"|"clear"|"trap"}`.
- `{"t":"slot","slot":2}` — TV re-assigned this phone (phone should just display it).

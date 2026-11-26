package io.loderunner2099.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

/**
 * Lode Runner 2099 for Android TV: a fullscreen WebView on PUBLIC_URL/tv?app=1.
 * D-pad / OK / media keys and Bluetooth keyboard keys go to the page as normal key events.
 * Full desktop shortcuts work on a BT keyboard: arrows/WASD, Z/X dig, P pause, T theme,
 * C CRT, M sound, B music, R restart, N new seed and +/- speed. BACK calls window.lr2099OnBack() if the page
 * defines it (return true = handled); otherwise press BACK twice to exit. MENU = change server URL.
 * The page sees window.LR2099TV {version(), serverUrl(), exit()} — only pages on the configured server host load.
 */
public class MainActivity extends Activity {
    static final String DEFAULT_URL = "https://loderunner2099.exe.xyz/tv?app=1";
    private static final String PREFS = "lr2099", PREF_URL = "url";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private String homeUrl;
    private boolean failed;
    private long lastBackAt;

    private final Runnable retry = new Runnable() {
        @Override public void run() { if (failed) { failed = false; web.loadUrl(homeUrl); } }
    };

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        homeUrl = prefs().getString(PREF_URL, DEFAULT_URL);
        if (!allowedUrl(homeUrl)) homeUrl = DEFAULT_URL;
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 1, 15));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // music/radio autoplay on TV
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);           // no file:// or content:// access from the page
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setUserAgentString(s.getUserAgentString() + " LR2099TV/" + version());
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "LR2099TV");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            // stay on the configured server: other links open nowhere (TV has no browser UI)
            @Override @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView v, String url) { return !sameHost(url); }
            @Override public void onPageFinished(WebView v, String url) { if (!failed) v.requestFocus(); }
            @Override @SuppressWarnings("deprecation")
            public void onReceivedError(WebView v, int code, String desc, String url) {
                failed = true;
                v.loadDataWithBaseURL(null, "<body style='background:#05010f;color:#0ff;font:28px monospace;"
                        + "text-align:center;padding-top:20%'>LODE RUNNER 2099<br><br>Can't reach server<br>"
                        + "<small style='color:#f0f'>retrying… (MENU = change server)</small></body>", "text/html", "utf-8", null);
                handler.removeCallbacks(retry);
                handler.postDelayed(retry, 5000);
            }
        });
        immersive();
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(homeUrl);
        web.requestFocus();
    }

    /** https anywhere; plain http only for LAN / localhost dev servers. */
    static boolean allowedUrl(String u) {
        try {
            android.net.Uri p = android.net.Uri.parse(u);
            String h = p.getHost();
            if (h == null || h.isEmpty()) return false;
            if ("https".equals(p.getScheme())) return true;
            return "http".equals(p.getScheme()) && (h.equals("localhost") || h.endsWith(".local") || h.startsWith("10.")
                    || h.startsWith("192.168.") || h.matches("172\\.(1[6-9]|2\\d|3[01])\\..*") || h.startsWith("127."));
        } catch (Exception e) { return false; }
    }

    private boolean sameHost(String url) {
        String a = android.net.Uri.parse(url).getHost(), b = android.net.Uri.parse(homeUrl).getHost();
        return a != null && a.equalsIgnoreCase(b);
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    class Bridge {
        @JavascriptInterface public String version() { return MainActivity.this.version(); }
        @JavascriptInterface public String serverUrl() { return homeUrl; }
        @JavascriptInterface public void exit() { handler.post(new Runnable() { @Override public void run() { finish(); } }); }
        @JavascriptInterface public void setRotateRemote(boolean on) { rotateRemote = on; }
        @JavascriptInterface public void setSinglePlayer(boolean on) {
            singlePlayer = on;
            padPlayer.clear(); padPlayers = 0;
        }
        @JavascriptInterface public void setRemoteIsP1(boolean on) {
            remoteIsP1 = on;
            padPlayer.clear(); padPlayers = 0; // re-assign on next input
        }
        @JavascriptInterface public boolean gamepadSeen() { return !padPlayer.isEmpty(); }
        @JavascriptInterface public String lastKey() { return lastKeyDebug; }
        @JavascriptInterface public String inputDevices() {
            StringBuilder sb = new StringBuilder();
            for (int id : InputDevice.getDeviceIds()) {
                InputDevice d = InputDevice.getDevice(id);
                if (d == null) continue;
                sb.append(id).append(": ").append(d.getName())
                  .append(" [src=0x").append(Integer.toHexString(d.getSources())).append("] ")
                  .append(isGamepad(id) ? "GAMEPAD" : "remote/key").append("\n");
            }
            return sb.toString();
        }
    }

    // ---- Bluetooth gamepad support -------------------------------------------------------
    // WebView's Gamepad API is unreliable on Android TV, so we capture the controller natively
    // and feed action bits into the page (window.__INPUT__.remote.feedMessage). Any BT controller
    // Android pairs (Xbox/PS/8BitDo/generic) works. Player 0 = first controller, player 1 = second.
    private final java.util.Map<Integer, Integer> padPlayer = new java.util.HashMap<>(); // deviceId -> player
    private int padPlayers = 0;
    private boolean rotateRemote = false;
    private String lastKeyDebug = ""; // Onn remote held sideways: D-pad rotated 90°
    private long lastStickSent = 0;
    private final boolean[] stickState = new boolean[4]; // L R U D latched state

    // Player slots: BT controllers are assigned in connection order. If a gamepad is present and the
    // remote-as-P1 preference is on, controllers start at player 1 so the TV remote stays player 0.
    private boolean remoteIsP1 = true;
    private int playerFor(int deviceId) {
        Integer p = padPlayer.get(deviceId);
        if (p != null) return p;
        int base = remoteIsP1 ? 1 : 0;
        int slot = Math.min(base + padPlayers++, 1);
        padPlayer.put(deviceId, slot);
        return slot;
    }

    private boolean isGamepad(int deviceId) {
        InputDevice d = InputDevice.getDevice(deviceId);
        if (d == null) return false;
        int s = d.getSources();
        String n = d.getName() == null ? "" : d.getName().toLowerCase();
        // A Bluetooth keyboard must stay on the WebView key path: letter keys are shortcuts
        // (T/C/M/B/R/N/+/-), arrows/WASD and Z/X are gameplay. Some combo devices advertise
        // joystick axes too; their keyboard letters must not be swallowed as gamepad buttons.
        boolean keyboard = (s & InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD;
        if (keyboard && d.getKeyboardType() == InputDevice.KEYBOARD_TYPE_ALPHABETIC) return false;
        // A TV remote (Onn/Google TV) is NOT a gamepad even though it exposes SOURCE_DPAD and a
        // "controller"-ish name. Exclude it explicitly so it stays on the normal remote/key path.
        boolean remote = n.contains("remote") || n.contains("onn") || n.contains("google tv")
            || n.contains("chromecast") || n.contains("android tv") || n.contains("atv");
        if ((s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK) return !remote;
        // Switch-protocol pads (8BitDo Ultimate C BT, Pro Controller) sometimes expose only DPAD/KEYBOARD.
        if (remote) return false;
        boolean named = n.contains("8bitdo") || n.contains("pro controller") || n.contains("switch")
            || n.contains("gamepad") || n.contains("joystick");
        return named && (s & InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD;
    }

    // singlePlayer mirrors every controller onto player 0 so a BT gamepad always works in 1P,
    // while the TV remote keeps working too. Set by the page on game start (mode).
    private boolean singlePlayer = true;

    private void sendPad(int player, String action, boolean down) {
        int p = singlePlayer ? 0 : player;
        String js = "(function(){try{var i=window.__INPUT__;if(i)i.remote.feedMessage({p:" + p
            + ",action:'" + action + "',down:" + down + "});}catch(e){}})()";
        web.evaluateJavascript(js, null);
    }

    // Analog sticks + triggers arrive as MotionEvent (not KeyEvent).
    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (!isGamepad(e.getDeviceId())) return super.dispatchGenericMotionEvent(e);
        int player = playerFor(e.getDeviceId());
        float lx = e.getAxisValue(MotionEvent.AXIS_X);
        float ly = e.getAxisValue(MotionEvent.AXIS_Y);
        float rx = e.getAxisValue(MotionEvent.AXIS_Z);   // right stick on most pads
        float ry = e.getAxisValue(MotionEvent.AXIS_RZ);
        float lt = e.getAxisValue(MotionEvent.AXIS_LTRIGGER);
        float rt = e.getAxisValue(MotionEvent.AXIS_RTRIGGER);
        float hatX = e.getAxisValue(MotionEvent.AXIS_HAT_X);
        float hatY = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
        float dz = 0.5f;
        boolean[] now = { lx < -dz || rx < -dz || hatX < -dz, lx > dz || rx > dz || hatX > dz,
                          ly < -dz || ry < -dz || hatY < -dz, ly > dz || ry > dz || hatY > dz };
        String[] names = { "left", "right", "up", "down" };
        for (int i = 0; i < 4; i++) {
            if (now[i] != stickState[i]) { stickState[i] = now[i]; sendPad(player, names[i], now[i]); }
        }
        // Triggers as dig buttons (edge-triggered on threshold).
        digAxis(player, 0, lt > 0.5f);
        digAxis(player, 1, rt > 0.5f);
        return true;
    }

    private final boolean[] trigState = new boolean[2];
    private void digAxis(int player, int idx, boolean on) {
        if (on != trigState[idx]) { trigState[idx] = on; sendPad(player, idx == 0 ? "digLeft" : "digRight", on); }
    }

    // Gamepad buttons arrive as KeyEvent with gamepad source.
    private boolean handleGamepadKey(KeyEvent e) {
        if (!isGamepad(e.getDeviceId())) return false;
        int player = playerFor(e.getDeviceId());
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        if (e.getRepeatCount() > 0) return true; // ignore auto-repeat
        String action = null;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT:  action = "left"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: action = "right"; break;
            case KeyEvent.KEYCODE_DPAD_UP:    action = "up"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN:  action = "down"; break;
            case KeyEvent.KEYCODE_BUTTON_A:   action = "confirm"; break;
            case KeyEvent.KEYCODE_BUTTON_B:   action = "back"; break;
            case KeyEvent.KEYCODE_BUTTON_C:   action = "confirm"; break;  // some Switch-layout pads
            case KeyEvent.KEYCODE_BUTTON_X:   action = "digLeft"; break;
            case KeyEvent.KEYCODE_BUTTON_Y:   action = "digRight"; break;
            case KeyEvent.KEYCODE_BUTTON_Z:   action = "digRight"; break;
            case KeyEvent.KEYCODE_BUTTON_L1:  action = "digLeft"; break;
            case KeyEvent.KEYCODE_BUTTON_R1:  action = "digRight"; break;
            case KeyEvent.KEYCODE_BUTTON_L2:  action = "digLeft"; break;
            case KeyEvent.KEYCODE_BUTTON_R2:  action = "digRight"; break;
            case KeyEvent.KEYCODE_BUTTON_START: action = "pause"; break;
            case KeyEvent.KEYCODE_BUTTON_SELECT: action = "back"; break;
            case KeyEvent.KEYCODE_BUTTON_MODE: action = "pause"; break;   // home/guide on some pads
            case KeyEvent.KEYCODE_BUTTON_THUMBL: break;                  // stick clicks: ignore
            case KeyEvent.KEYCODE_BUTTON_THUMBR: break;
            default: return true; // consume other gamepad buttons
        }
        if (action != null) sendPad(player, action, down);
        return true;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        InputDevice kd = InputDevice.getDevice(e.getDeviceId());
        lastKeyDebug = (kd == null ? "?" : kd.getName()) + " code=" + code + " gamepad=" + isGamepad(e.getDeviceId());
        if (isGamepad(e.getDeviceId())) return handleGamepadKey(e);
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
            if (e.getAction() == KeyEvent.ACTION_UP) showUrlDialog();
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_UP) onBackKey();
            return true;
        }
        if (rotateRemote) {
            int rotated = rotateDpad(code);
            if (rotated != code) { e = new KeyEvent(e.getDownTime(), e.getEventTime(), e.getAction(), rotated, e.getRepeatCount(), e.getMetaState(), e.getDeviceId(), e.getScanCode(), e.getFlags(), e.getSource()); code = rotated; }
        }
        if (!web.hasFocus()) web.requestFocus();
        return super.dispatchKeyEvent(e); // D-pad, OK (Enter), media keys → page keydown/keyup
    }

    private static int rotateDpad(int code) {
        // Remote held sideways (90° CCW): physical up = left, right = up, down = right, left = down.
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return KeyEvent.KEYCODE_DPAD_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return KeyEvent.KEYCODE_DPAD_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN: return KeyEvent.KEYCODE_DPAD_RIGHT;
            case KeyEvent.KEYCODE_DPAD_LEFT: return KeyEvent.KEYCODE_DPAD_DOWN;
            default: return code;
        }
    }

    private void onBackKey() {
        if (failed) { exitOrWarn(); return; }
        web.evaluateJavascript("(function(){try{return !!(window.lr2099OnBack&&window.lr2099OnBack());}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String v) { if (!"true".equals(v)) exitOrWarn(); }
                });
    }

    private void exitOrWarn() {
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) { finish(); return; }
        lastBackAt = now;
        Toast.makeText(this, "Press Back again to exit Lode Runner 2099", Toast.LENGTH_SHORT).show();
    }

    private void showUrlDialog() {
        final EditText in = new EditText(this);
        in.setSingleLine(true);
        in.setText(homeUrl);
        new AlertDialog.Builder(this).setTitle("Server URL").setView(in)
                .setPositiveButton("Load", (d, w) -> {
                    String u = in.getText().toString().trim();
                    if (allowedUrl(u)) {
                        homeUrl = u;
                        prefs().edit().putString(PREF_URL, u).apply();
                    }
                    failed = false;
                    web.loadUrl(homeUrl);
                })
                .setNeutralButton("Reset", (d, w) -> {
                    homeUrl = DEFAULT_URL;
                    prefs().edit().remove(PREF_URL).apply();
                    failed = false;
                    web.loadUrl(homeUrl);
                })
                .setNegativeButton("Cancel", null)
                .setOnDismissListener(d -> { immersive(); web.requestFocus(); })
                .show();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { handler.removeCallbacks(retry); web.destroy(); super.onDestroy(); }
}

package io.loderunner2099.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
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
 * D-pad / OK / media keys go to the page as normal key events. BACK calls window.lr2099OnBack() if the page
 * defines it (return true = handled); otherwise press BACK twice to exit. MENU = change server URL.
 * The page sees window.LR2099TV {version(), serverUrl(), exit()}.
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
        s.setUserAgentString(s.getUserAgentString() + " LR2099TV/" + version());
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "LR2099TV");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
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

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    class Bridge {
        @JavascriptInterface public String version() { return MainActivity.this.version(); }
        @JavascriptInterface public String serverUrl() { return homeUrl; }
        @JavascriptInterface public void exit() { handler.post(new Runnable() { @Override public void run() { finish(); } }); }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
            if (e.getAction() == KeyEvent.ACTION_UP) showUrlDialog();
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_UP) onBackKey();
            return true;
        }
        if (!web.hasFocus()) web.requestFocus();
        return super.dispatchKeyEvent(e); // D-pad, OK (Enter), media keys → page keydown/keyup
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
                    if (u.startsWith("http://") || u.startsWith("https://")) {
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

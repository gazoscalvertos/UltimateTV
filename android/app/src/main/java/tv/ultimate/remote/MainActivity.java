package tv.ultimate.remote;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

import org.json.JSONObject;

/**
 * The UltimateTV phone remote. It asks once for the Hub's address, then shows the Hub's remote
 * page full screen. The phone's Back button and volume keys work as remote keys too, and the
 * Voice button listens with the phone's speech recogniser (WebView pages can't use the microphone
 * over the Hub's plain http).
 */
public class MainActivity extends Activity {
    private static final String DEFAULT_HUB = "http://192.168.0.19:8095";
    private static final int BG = Color.rgb(7, 11, 20);
    private static final int VOICE_REQUEST = 1;

    private SharedPreferences prefs;
    private WebView web;
    private String hub;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        prefs = getSharedPreferences("remote", MODE_PRIVATE);
        hub = prefs.getString("hub", null);
        if (hub == null) showSetup(null);
        else showRemote();
    }

    private void showSetup(String error) {
        web = null;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(BG);
        int pad = dp(28);
        box.setPadding(pad, dp(80), pad, pad);

        TextView title = new TextView(this);
        title.setText("Connect to your Hub");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText(error != null ? error : "Enter the address of the UltimateTV Hub on your home network. It's shown in Settings › Phone remote on the TV.");
        hint.setTextColor(error != null ? Color.rgb(255, 120, 135) : Color.rgb(154, 166, 189));
        hint.setTextSize(15);
        hint.setPadding(0, dp(12), 0, dp(24));
        box.addView(hint);

        final EditText input = new EditText(this);
        input.setText(hub != null ? hub : DEFAULT_HUB);
        input.setTextColor(Color.WHITE);
        input.setTextSize(18);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        box.addView(input);

        final Button connect = new Button(this);
        connect.setText("Connect");
        connect.setTextSize(17);
        connect.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(24);
        box.addView(connect, lp);

        final TextView status = new TextView(this);
        status.setTextColor(Color.rgb(154, 166, 189));
        status.setGravity(Gravity.CENTER_HORIZONTAL);
        status.setPadding(0, dp(16), 0, 0);
        box.addView(status);

        View.OnClickListener go = v -> {
            String address = normalise(input.getText().toString());
            status.setText("Checking " + address + "…");
            connect.setEnabled(false);
            new Thread(() -> {
                boolean ok = reachable(address);
                main.post(() -> {
                    connect.setEnabled(true);
                    if (ok) {
                        hub = address;
                        prefs.edit().putString("hub", address).apply();
                        showRemote();
                    } else {
                        status.setText("Couldn't reach " + address + ". Check the address and that the phone is on your home Wi-Fi.");
                    }
                });
            }).start();
        };
        connect.setOnClickListener(go);
        input.setOnEditorActionListener((v, actionId, event) -> {
            go.onClick(v);
            return true;
        });
        setContentView(box);
    }

    private void showRemote() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "UltimateTVApp");
        // The settings page asks with confirm() and prompt(), which only show with a chrome client.
        web.setWebChromeClient(new WebChromeClient());
        // Downloads (the remote's own APK) go to the browser, which saves and installs them.
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, length) -> openInBrowser(url));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showSetup("Couldn't open the remote at " + hub + ". Is the Hub running?");
            }
        });
        web.loadUrl(hub + "/remote/");
        setContentView(web);
    }

    /** Lets the remote page offer "Change Hub" and voice control. */
    private class Bridge {
        @JavascriptInterface
        public void changeHub() {
            main.post(() -> showSetup(null));
        }

        /** The app's version code, so the page can say when a newer app is on the Hub. */
        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public int version() {
            try {
                // versionCode rather than getLongVersionCode(), which needs Android 9.
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void open(String url) {
            main.post(() -> openInBrowser(url));
        }

        @JavascriptInterface
        public void listen() {
            main.post(MainActivity.this::startListening);
        }
    }

    private void openInBrowser(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // No browser: nothing sensible to do.
        }
    }

    private void startListening() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say a channel, a film or a command");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, VOICE_REQUEST);
        } catch (ActivityNotFoundException e) {
            voiceError("This phone has no speech recogniser. Install or enable the Google app.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE_REQUEST || web == null) return;
        ArrayList<String> results = data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (resultCode == RESULT_OK && results != null && !results.isEmpty()) {
            web.evaluateJavascript("window.utvVoiceResult && window.utvVoiceResult(" + JSONObject.quote(results.get(0)) + ")", null);
        } else {
            voiceError("Didn't catch that");
        }
    }

    private void voiceError(String message) {
        if (web != null) web.evaluateJavascript("window.utvVoiceError && window.utvVoiceError(" + JSONObject.quote(message) + ")", null);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (web == null) return super.onKeyDown(keyCode, event);
        // The phone's Back button is the TV's Back button; volume keys change channel.
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:
                // On the settings page Back returns to the remote; on the remote it's the TV's Back.
                String url = web.getUrl();
                if (url != null && !url.contains("/remote/") && web.canGoBack()) web.goBack();
                else sendKey("back");
                return true;
            case KeyEvent.KEYCODE_VOLUME_UP:
                sendKey("channelUp");
                return true;
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                sendKey("channelDown");
                return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    private void sendKey(String action) {
        final String address = hub;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(address + "/api/remote/key").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(3000);
                c.setReadTimeout(3000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) {
                    out.write(("{\"action\":\"" + action + "\"}").getBytes(StandardCharsets.UTF_8));
                }
                c.getResponseCode();
                c.disconnect();
            } catch (Exception ignored) {
                // The page shows the connection state; a lost key press isn't worth an error.
            }
        }).start();
    }

    private static boolean reachable(String address) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(address + "/api/health").openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private static String normalise(String raw) {
        String a = raw.trim();
        if (!a.startsWith("http://") && !a.startsWith("https://")) a = "http://" + a;
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        if (!a.matches("^https?://[^/]+:\\d+$") && !a.matches("^https?://[^/]+:\\d+/.*")) {
            // No port given: the Hub's default.
            if (a.matches("^https?://[^/:]+$")) a = a + ":8095";
        }
        return a;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

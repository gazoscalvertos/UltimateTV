package tv.ultimate.remote;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

import org.json.JSONObject;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * The UltimateTV phone remote. It asks once for the Hub's address, then shows the Hub's remote
 * page full screen. The phone's Back button and volume keys work as remote keys too, and the
 * Voice button listens with the phone's speech recogniser (WebView pages can't use the microphone
 * over the Hub's plain http). The Hub only takes control from paired phones: scanning the code
 * the TV shows (Settings › Phones and remotes) both finds the Hub and pairs the phone.
 */
public class MainActivity extends Activity {
    private static final String DEFAULT_HUB = "http://192.168.0.19:8095";
    private static final int BG = Color.rgb(7, 11, 20);
    private static final int VOICE_REQUEST = 1;
    private static final int FILE_REQUEST = 2;

    private SharedPreferences prefs;
    private WebView web;
    private String hub;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** The page's photo or video picker (Pop-up on the TV) waiting for the phone's gallery. */
    private ValueCallback<Uri[]> fileCallback;

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
        // Less room above in landscape, and it scrolls, so Connect stays reachable with the keyboard up.
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        box.setPadding(pad, dp(landscape ? 24 : 80), pad, pad);

        TextView title = new TextView(this);
        title.setText("Connect to your Hub");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText(error != null ? error : "On the TV, open Settings › Phones and remotes and scan the code. Or type the Hub's address, shown under the code.");
        hint.setTextColor(error != null ? Color.rgb(255, 120, 135) : Color.rgb(154, 166, 189));
        hint.setTextSize(15);
        hint.setPadding(0, dp(12), 0, dp(24));
        box.addView(hint);

        final Button scan = new Button(this);
        scan.setText("Scan the TV's code");
        scan.setTextSize(17);
        scan.setAllCaps(false);
        scan.setOnClickListener(v -> startScan(true));
        box.addView(scan, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

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
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        scroll.addView(box);
        setContentView(scroll);
    }

    private void showRemote() {
        showRemote(hub + "/remote/");
    }

    private void showRemote(String page) {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "UltimateTVApp");
        // The settings page asks with confirm() and prompt(), which only show with a chrome client.
        // It also opens the gallery for the remote's "Add photo or video".
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                // Built by hand: the params' own intent only offers the first type (photos, not videos).
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "video/*"});
                try {
                    startActivityForResult(Intent.createChooser(pick, "Photo or video"), FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });
        // Downloads (the remote's own APK) go to the browser, which saves and installs them.
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, length) -> openInBrowser(url));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showSetup("Couldn't open the remote at " + hub + ". Is the Hub running?");
            }
        });
        web.loadUrl(page);
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

        /** The page's pairing screen: scan the TV's code; the answer goes to window.utvScanResult. */
        @JavascriptInterface
        public void scan() {
            main.post(() -> startScan(false));
        }
    }

    private void openInBrowser(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // No browser: nothing sensible to do.
        }
    }

    /**
     * Scans the TV's pairing code, an address like http://192.168.0.19:8095/remote/?pair=ABCDEFGH.
     * From the setup screen it also sets the Hub's address and opens the remote, which pairs.
     */
    private void startScan(boolean fromSetup) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        GmsBarcodeScanning.getClient(this, options).startScan()
                .addOnSuccessListener(code -> {
                    String text = code.getRawValue() != null ? code.getRawValue() : "";
                    Uri uri = Uri.parse(text);
                    String pair = null;
                    try {
                        pair = uri.getQueryParameter("pair");
                    } catch (UnsupportedOperationException ignored) {
                        // Not an address at all (a Wi-Fi code, say): handled below.
                    }
                    if (fromSetup) {
                        if (uri.getScheme() == null || !uri.getScheme().startsWith("http") || uri.getAuthority() == null) {
                            showSetup("That isn't the TV's code. Scan the one in Settings › Phones and remotes.");
                            return;
                        }
                        hub = uri.getScheme() + "://" + uri.getAuthority();
                        prefs.edit().putString("hub", hub).apply();
                        showRemote(hub + "/remote/" + (pair != null ? "?pair=" + Uri.encode(pair) : ""));
                    } else if (web != null) {
                        web.evaluateJavascript("window.utvScanResult && window.utvScanResult(" + JSONObject.quote(text) + ")", null);
                    }
                })
                .addOnFailureListener(e -> {
                    String message = "The scanner didn't start. Type the code shown on the TV instead.";
                    if (fromSetup) showSetup(message);
                    else if (web != null) web.evaluateJavascript("window.utvScanError && window.utvScanError(" + JSONObject.quote(message) + ")", null);
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        // The pairing cookie is written to disk now rather than later, in case the app is closed.
        CookieManager.getInstance().flush();
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
        if (requestCode == FILE_REQUEST) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
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
                // The pairing cookie the Hub gave the remote page: key presses need it too.
                String cookie = CookieManager.getInstance().getCookie(address);
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
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

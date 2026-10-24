package tv.ultimate.remote;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
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

/**
 * The UltimateTV phone remote. It asks once for the Hub's address, then shows the Hub's remote
 * page full screen. The phone's Back button and volume keys work as remote keys too.
 */
public class MainActivity extends Activity {
    private static final String DEFAULT_HUB = "http://192.168.0.19:8095";
    private static final int BG = Color.rgb(7, 11, 20);

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
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showSetup("Couldn't open the remote at " + hub + ". Is the Hub running?");
            }
        });
        web.loadUrl(hub + "/remote/");
        setContentView(web);
    }

    /** Lets the remote page offer "Change Hub". */
    private class Bridge {
        @JavascriptInterface
        public void changeHub() {
            main.post(() -> showSetup(null));
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (web == null) return super.onKeyDown(keyCode, event);
        // The phone's Back button is the TV's Back button; volume keys change channel.
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:
                sendKey("back");
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

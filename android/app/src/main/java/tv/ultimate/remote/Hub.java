package tv.ultimate.remote;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Everything the app asks of the Hub, in one place: the address the phone was paired with, key
 * presses, what the TV is playing and a picture of it. The notification, the Quick Settings tile and
 * the home-screen widget all go through here, so they work without the remote page open.
 */
final class Hub {
    private Hub() {}

    static final String PREFS = "remote";
    static final String KEY_HUB = "hub";
    /** The pairing cookie as text, kept so a notification or tile can reach the Hub without a WebView. */
    static final String KEY_COOKIE = "cookie";

    /** The Hub's address, or null before the phone has been set up. */
    static String address(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(KEY_HUB, null);
    }

    static void setAddress(Context c, String address) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_HUB, address).apply();
    }

    /**
     * Keeps the pairing cookie where the notification, tile and widget can find it. Only the remote
     * page can read it, because the Hub makes it HttpOnly — and those run without a WebView in
     * reach, after the phone has been rebooted for instance. Called whenever the page has been open.
     */
    static void rememberCookie(Context c) {
        String address = address(c);
        if (address == null) return;
        try {
            String cookie = CookieManager.getInstance().getCookie(address);
            if (cookie != null && !cookie.isEmpty()) {
                c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_COOKIE, cookie).apply();
            }
        } catch (Exception ignored) {
            // No WebView in this process yet: nothing to copy, and the page will do it later.
        }
    }

    /**
     * A key press to the TV. It goes on a thread of its own and a failure is ignored: the page shows
     * the connection state, and a lost key press isn't worth an error.
     */
    static void key(Context c, String action) {
        final String address = address(c);
        if (address == null) return;
        final Context app = c.getApplicationContext();
        new Thread(() -> request(app, address, "/api/remote/key", "POST", "{\"action\":\"" + action + "\"}", 3_000)).start();
    }

    /**
     * What the TV is playing. The Hub holds the request open until it changes (or {@code waitMs} has
     * passed), so this is one request rather than asking over and over. Null when the Hub can't be
     * reached or the phone isn't paired to it any more.
     */
    static JSONObject now(Context c, long since, int waitMs) {
        String address = address(c);
        if (address == null) return null;
        String body = request(c, address, "/api/remote/now?since=" + since + "&wait=" + waitMs, "GET", null, waitMs + 5_000);
        if (body == null) return null;
        try {
            return new JSONObject(body);
        } catch (Exception e) {
            return null;
        }
    }

    /** A small download (the artwork), or null. */
    static byte[] bytes(Context c, String url, int timeoutMs) {
        if (url == null || url.isEmpty()) return null;
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5_000);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("Cookie", cookie(c, url));
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8_192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    // Artwork is a few hundred KB at most; don't follow anything enormous.
                    if (out.size() > 4 * 1024 * 1024) return null;
                }
                return out.toByteArray();
            } finally {
                conn.disconnect();
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String request(Context c, String address, String path, String method, String json, int timeoutMs) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(address + path).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(5_000);
            conn.setReadTimeout(timeoutMs);
            // The pairing cookie the Hub gave the remote page: the Hub only answers paired phones.
            String cookie = cookie(c, address);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            if (json != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            if (conn.getResponseCode() != 200) {
                conn.disconnect();
                return null;
            }
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8_192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString(StandardCharsets.UTF_8.name());
            } finally {
                conn.disconnect();
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String cookie(Context c, String address) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String kept = p.getString(KEY_COOKIE, null);
        try {
            String live = CookieManager.getInstance().getCookie(address);
            if (live != null && !live.isEmpty()) {
                if (!live.equals(kept)) p.edit().putString(KEY_COOKIE, live).apply();
                return live;
            }
        } catch (Exception ignored) {
            // No WebView in this process (a service after a reboot): fall back to the copy we kept.
        }
        return kept;
    }

    /** The Hub answers on /api/health once it's up. */
    static boolean reachable(String address) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(address + "/api/health").openConnection();
            c.setConnectTimeout(4_000);
            c.setReadTimeout(4_000);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }
}

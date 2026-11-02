package tv.ultimate.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

/**
 * A media notification in the phone's shade while the TV is playing (and the lock screen, if the
 * phone shows notifications there), so the thing on the telly can be paused without picking the
 * phone's remote out of the app drawer. It disappears when the TV stops.
 *
 * <p>Battery: it asks the Hub for the state once and the Hub holds the request open until something
 * changes, so there is no polling — one idle request sits on the Hub until the TV starts playing,
 * and the app is told when it does. While nothing plays, the service stops itself, so there is no
 * process of ours left running and no requests at all.
 */
public class NowPlayingService extends Service {
    static final String CHANNEL = "now-playing";
    static final int NOTIFICATION_ID = 4201;
    /** Wakes the service from the notification's buttons. */
    static final String ACTION_KEY = "tv.ultimate.remote.KEY";
    static final String EXTRA_ACTION = "action";
    /** Asks it to pick the TV's state up again (after the page has opened, or a notification came in). */
    static final String ACTION_REFRESH = "tv.ultimate.remote.REFRESH";
    static final String ACTION_STOP = "tv.ultimate.remote.STOP";

    private static final long RETRY_MS = 15_000;
    /** Give up after this many misses in a row, so a phone carried out of the house stops asking. */
    private static final int MAX_MISSES = 3;

    /** What the TV is playing, as the last answer said; null when it isn't playing anything. */
    private static volatile JSONObject lastState;
    /** The Hub's counter from the last answer; -1 asks for an answer straight away. */
    private static volatile long lastSeq = -1;

    private volatile boolean running;
    private Thread worker;

    /** Starts the shade's media notification, if there's a Hub to ask and the phone allows it. */
    static void start(Context c) {
        if (Hub.address(c) == null) return;
        Intent i = new Intent(c, NowPlayingService.class).setAction(ACTION_REFRESH);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // Android 12+ refuses a background foreground-service start; the tile and the widget
            // still work, and opening the app starts it again.
        }
    }

    /** What the tile and the widget show without asking the Hub: the last thing heard. */
    static JSONObject last() {
        return lastState;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channel(this);
        // A foreground service has to say so within five seconds of being started, so start with the
        // last thing we knew and let the first answer replace it (or take it away).
        startForeground(NOTIFICATION_ID, placeholder());
        running = true;
        lastSeq = -1;
        worker = new Thread(this::loop, "now-playing");
        worker.setDaemon(true);
        worker.start();
    }

    /**
     * Shown for the moment it takes the Hub to say what's playing. The first request doesn't wait, so
     * a phone with nothing on the TV shows this for a moment and then nothing at all.
     */
    private Notification placeholder() {
        JSONObject state = lastState;
        String status = state != null ? state.optString("state", "off") : "off";
        if ("playing".equals(status) || "paused".equals(status) || "buffering".equals(status)) {
            Notification.Builder b = new Notification.Builder(this, CHANNEL)
                    .setSmallIcon(R.drawable.ic_tv)
                    .setContentTitle(state.optString("media_title", "The TV"))
                    .setContentIntent(openRemote())
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setShowWhen(false)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setCategory(Notification.CATEGORY_TRANSPORT);
            return b.build();
        }
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_tv)
                .setContentTitle("TV remote")
                .setContentText("Looking at the TV")
                .setContentIntent(openRemote())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_KEY.equals(action)) {
            String key = intent.getStringExtra(EXTRA_ACTION);
            if (key != null) Hub.key(this, key);
            // The TV's state follows in a moment; asking now keeps the notification honest.
            wake();
        } else if (ACTION_STOP.equals(action)) {
            Hub.key(this, "pause");
            wake();
        } else {
            wake();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    /** Asks the waiting thread to look at the TV again. */
    private synchronized void wake() {
        notifyAll();
    }

    /**
     * One long request at a time: the Hub answers when the TV's state changes, or after a few
     * seconds so a Wi-Fi hiccup is noticed. Nothing plays → the service stops itself.
     */
    private void loop() {
        int misses = 0;
        while (running) {
            JSONObject reply = Hub.now(this, lastSeq, 20_000);
            if (!running) return;
            if (reply == null) {
                // The Hub couldn't be reached: try again in a bit, and leave the notification up for
                // a moment rather than flashing it away on one missed request.
                if (++misses >= MAX_MISSES) {
                    stopSelfSafely();
                    return;
                }
                synchronized (this) {
                    try {
                        wait(RETRY_MS);
                    } catch (InterruptedException e) {
                        return;
                    }
                }
                continue;
            }
            misses = 0;
            lastSeq = reply.optLong("seq", lastSeq);
            JSONObject state = reply.optJSONObject("state");
            lastState = state;
            String status = state != null ? state.optString("state", "off") : "off";
            if ("playing".equals(status) || "paused".equals(status) || "buffering".equals(status)) {
                show(state, status);
            } else {
                stopSelfSafely();
                return;
            }
        }
    }

    private void stopSelfSafely() {
        running = false;
        lastState = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /**
     * Builds the notification: the title, the picture, the position and the buttons that make sense
     * for it. Live TV gets channel up/down instead of a seek bar.
     */
    private void show(JSONObject state, String status) {
        boolean playing = "playing".equals(status);
        boolean live = "channel".equals(state.optString("media_content_type", ""));
        String title = state.optString("media_title", "");
        String subtitle = state.optString("media_series_title", "");
        if (title.isEmpty()) return; // Nothing worth a notification (the TV is on its menus).

        Notification.Builder b = new Notification.Builder(this, CHANNEL);
        b.setSmallIcon(R.drawable.ic_tv)
                .setContentTitle(title)
                .setContentText(subtitle.isEmpty() ? appName(state) : subtitle)
                .setContentIntent(openRemote())
                .setDeleteIntent(service(ACTION_STOP))
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT);
        Bitmap art = artwork(state.optString("entity_picture", null));
        if (art != null) b.setLargeIcon(art);
        if (!live) {
            // Home Assistant's media_duration and media_position are in seconds, not milliseconds.
            long duration = Math.round(state.optDouble("media_duration", 0) * 1000);
            long position = Math.round(state.optDouble("media_position", 0) * 1000);
            if (duration > 0) {
                b.setProgress((int) duration, (int) Math.min(position, duration), "buffering".equals(status));
                b.setSubText(fmt(position) + " / " + fmt(duration));
            }
        } else {
            String channel = state.optString("media_channel", "");
            if (!channel.isEmpty()) b.setSubText(channel);
        }
        b.addAction(action(playing ? "Pause" : "Play", playing ? "pause" : "playPause", android.R.drawable.ic_media_pause));
        if (live) {
            b.addAction(action("Channel −", "channelDown", android.R.drawable.ic_media_previous));
            b.addAction(action("Channel +", "channelUp", android.R.drawable.ic_media_next));
        } else {
            // The TV moves back 30 seconds and forward a minute, same as the remote's own keys.
            b.addAction(action("Back 30s", "rewind", android.R.drawable.ic_media_rew));
            b.addAction(action("On 1 min", "fastForward", android.R.drawable.ic_media_ff));
        }
        b.addAction(action("Back", "back", android.R.drawable.ic_menu_revert));
        // Media style puts the picture behind the notification on the lock screen and takes the
        // action buttons on Android 13+ without them sliding into a "more" menu.
        b.setStyle(new Notification.MediaStyle().setShowActionsInCompactView(0, 1));
        notify(b.build());
    }

    private void notify(Notification n) {
        try {
            NotificationManager m = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            // Belt and braces: startForeground can be a no-op after stopForeground on some phones.
            if (m != null) m.notify(NOTIFICATION_ID, n);
        } catch (Exception ignored) {
            // No notification permission (Android 13+): the tile and the widget still work.
        }
    }

    private Notification.Action action(String label, String key, int icon) {
        Intent i = new Intent(this, NowPlayingService.class).setAction(ACTION_KEY).putExtra(EXTRA_ACTION, key);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent p = PendingIntent.getService(this, key.hashCode(), i, flags);
        return new Notification.Action.Builder(icon, label, p).build();
    }

    private PendingIntent service(String action) {
        Intent i = new Intent(this, NowPlayingService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, action.hashCode(), i, flags);
    }

    private PendingIntent openRemote() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(this, 0, i, flags);
    }

    private String appName(JSONObject state) {
        String profile = state.optString("profile", "");
        return profile.isEmpty() ? "Playing on the TV" : "Playing for " + profile;
    }

    private Bitmap artwork(String url) {
        if (url == null || url.isEmpty()) return null;
        byte[] data = Hub.bytes(this, url, 4_000);
        if (data == null) return null;
        try {
            return BitmapFactory.decodeByteArray(data, 0, data.length);
        } catch (Exception e) {
            return null;
        }
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms) / 1000;
        return String.format(java.util.Locale.UK, "%d:%02d", s / 60, s % 60);
    }

    /** One channel for the notification, made once. Silent: it's a remote, not a music player. */
    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager m = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (m == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "What's playing on the TV", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("What the TV is playing, with play and pause, while it's playing.");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        m.createNotificationChannel(ch);
    }
}

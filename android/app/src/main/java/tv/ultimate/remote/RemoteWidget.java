package tv.ultimate.remote;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * A TV remote on the phone's home screen: the d-pad, OK, Back and the four colour keys, so the
 * telly can be driven without unlocking the phone and opening the app. It resizes, and it says what
 * is playing across the top.
 *
 * <p>The buttons go through the same key path as the app ({@link Hub#key}), so they work whether or
 * not the remote page is open. Nothing here polls: the title comes from the same long request the
 * notification uses.
 */
public class RemoteWidget extends AppWidgetProvider {
    /** A button was pressed. */
    static final String ACTION_KEY = "tv.ultimate.remote.WIDGET_KEY";
    static final String EXTRA_ACTION = "action";

    /** A small widget is four buttons and the title; a big one is the whole remote. */
    private static final int SHORT_DP = 200;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(c, m, id, NowPlayingService.last());
        // The first render may have no state to show: ask the TV (one long request, not a poll).
        NowPlayingService.start(c);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (ACTION_KEY.equals(intent.getAction())) {
            String key = intent.getStringExtra(EXTRA_ACTION);
            if (key != null) Hub.key(c, key);
            // Bring a fresh state back to the widget so the title keeps up.
            NowPlayingService.start(c);
            return;
        }
        if (AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(intent.getAction())) {
            // Resized: lay it out for the new size.
            refresh(c, NowPlayingService.last());
        }
    }

    /** Redraws every widget on the home screen with what the TV is doing (or with just the buttons). */
    static void refresh(Context c, JSONObject state) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            ComponentName me = new ComponentName(c, RemoteWidget.class);
            for (int id : m.getAppWidgetIds(me)) render(c, m, id, state);
        } catch (Exception ignored) {
            // No widgets placed, or the launcher is busy: nothing to do.
        }
    }

    private static void render(Context c, AppWidgetManager m, int id, JSONObject state) {
        String status = state != null ? state.optString("state", "off") : "off";
        String title = state != null ? state.optString("media_title", "") : "";
        String subtitle = state != null ? state.optString("media_series_title", "") : "";
        boolean playing = "playing".equals(status);
        String line;
        if (title.isEmpty()) line = "TV remote";
        else if (subtitle.isEmpty()) line = title;
        else line = title + " · " + subtitle;

        int height = 0;
        try {
            height = m.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        } catch (Exception ignored) {
            // An old launcher: treat it as a full-size widget.
        }
        boolean small = height > 0 && height < SHORT_DP;
        RemoteViews v = new RemoteViews(c.getPackageName(), small ? R.layout.widget_remote_small : R.layout.widget_remote);
        v.setTextViewText(R.id.widget_now, line);
        v.setContentDescription(R.id.widget_now, line);
        v.setOnClickPendingIntent(R.id.widget_now, openApp(c));
        v.setTextViewText(R.id.widget_play, playing ? "Pause" : "Play");
        v.setOnClickPendingIntent(R.id.widget_play, keyIntent(c, playing ? "pause" : "playPause"));
        v.setOnClickPendingIntent(R.id.widget_back, keyIntent(c, "back"));
        v.setOnClickPendingIntent(R.id.widget_home, keyIntent(c, "home"));
        if (!small) {
            v.setOnClickPendingIntent(R.id.widget_up, keyIntent(c, "up"));
            v.setOnClickPendingIntent(R.id.widget_down, keyIntent(c, "down"));
            v.setOnClickPendingIntent(R.id.widget_left, keyIntent(c, "left"));
            v.setOnClickPendingIntent(R.id.widget_right, keyIntent(c, "right"));
            v.setOnClickPendingIntent(R.id.widget_ok, keyIntent(c, "ok"));
            v.setOnClickPendingIntent(R.id.widget_red, keyIntent(c, "red"));
            v.setOnClickPendingIntent(R.id.widget_green, keyIntent(c, "green"));
            v.setOnClickPendingIntent(R.id.widget_yellow, keyIntent(c, "yellow"));
            v.setOnClickPendingIntent(R.id.widget_blue, keyIntent(c, "blue"));
        }
        try {
            m.updateAppWidget(id, v);
        } catch (Exception ignored) {
            // One launcher refusing a layout shouldn't stop the others.
        }
    }

    private static PendingIntent keyIntent(Context c, String action) {
        Intent i = new Intent(c, RemoteWidget.class).setAction(ACTION_KEY).putExtra(EXTRA_ACTION, action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        // The request code has to differ per action, or they all resolve to the same extra.
        return PendingIntent.getBroadcast(c, action.hashCode(), i, flags);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(c, 0, i, flags);
    }
}

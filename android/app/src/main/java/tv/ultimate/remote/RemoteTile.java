package tv.ultimate.remote;

import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import org.json.JSONObject;

/**
 * A play/pause button in the phone's Quick Settings, so the telly can be paused from the shade
 * without opening anything. Android 7+ only: below that there is no tile to add, and the app is
 * still the remote.
 */
public class RemoteTile extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        render(NowPlayingService.last());
        // Have a look at the TV, and keep a request open until it changes: the tile follows along
        // without polling, and the request is dropped the moment the shade is closed.
        NowPlayingService.start(this);
    }

    @Override
    public void onClick() {
        JSONObject state = NowPlayingService.last();
        String status = state != null ? state.optString("state", "off") : "off";
        boolean playing = "playing".equals(status);
        Hub.key(this, playing ? "pause" : "playPause");
        // The tile shows the change straight away; the Hub's answer corrects it a moment later.
        render(fakeState(state, playing ? "paused" : "playing"));
    }

    /** The tile says what the TV is doing, and is only "active" when it is doing something. */
    private void render(JSONObject state) {
        if (Build.VERSION.SDK_INT < 24) return;
        Tile tile = getQsTile();
        if (tile == null) return;
        String status = state != null ? state.optString("state", "off") : "off";
        boolean playing = "playing".equals(status);
        boolean awake = playing || "paused".equals(status) || "buffering".equals(status);
        tile.setState(awake ? (playing ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE) : Tile.STATE_UNAVAILABLE);
        if (status.equals("buffering")) tile.setState(Tile.STATE_ACTIVE);
        String title = state != null ? state.optString("media_title", "") : "";
        if (title.isEmpty()) {
            tile.setLabel("TV");
            tile.setContentDescription("What's playing on the TV");
        } else {
            tile.setLabel(playing ? "Pause" : "Play");
            tile.setContentDescription((playing ? "Pause " : "Play ") + title);
        }
        try {
            tile.setIcon(Icon.createWithResource(this, playing
                    ? android.R.drawable.ic_media_pause
                    : android.R.drawable.ic_media_play));
        } catch (Exception ignored) {
            // An icon is nice, the label carries the meaning.
        }
        tile.updateTile();
    }

    private static JSONObject fakeState(JSONObject was, String status) {
        try {
            JSONObject next = was != null ? new JSONObject(was.toString()) : new JSONObject();
            next.put("state", status);
            return next;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onTileAdded() {
        super.onTileAdded();
        // Adding the tile is a clear "yes, keep me up to date".
        NowPlayingService.start(this);
    }

    @Override
    public void onTileRemoved() {
        super.onTileRemoved();
        stopService(new Intent(this, NowPlayingService.class));
    }
}

// The player: full screen, landscape, with picture-in-picture. ExoPlayer opens the Hub's live TV
// (MPEG-TS), Jellyfin and TorBox files (MKV, HEVC) and recordings as they are; the FFmpeg audio
// renderer covers the Dolby and DTS soundtracks phones can't decode. Progress goes to the Hub every
// ten seconds, or is kept on the phone until it's home again.

package tv.ultimate.client

import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

class PlayerActivity : ComponentActivity() {
    private val scope = MainScope()
    /** For the last word to the Hub (stopped, left Sync play) after the screen has gone. */
    private val after = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val main = Handler(Looper.getMainLooper())
    private val hub get() = App.instance.hub

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private lateinit var topBar: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var subtitleView: TextView
    private lateinit var action: Button
    private lateinit var optionsButton: Button

    private var info: PlaybackInfo? = null
    private var req: PlaybackRequest? = null
    private var ref: TitleRef? = null
    private var offline: OfflineEntry? = null
    private var progressKey: String = ""
    private var live = false
    private var reported = false
    /** What this profile chose last time for this series, applied once the tracks are known (issue #228). */
    private var remembered: TrackPref? = null
    private var rememberedApplied = true

    private val ticker = object : Runnable {
        override fun run() {
            report("progress")
            if (System.currentTimeMillis() - lastWatchReport >= WATCH_REPORT_MS) reportWatching("progress")
            if (group != null && System.currentTimeMillis() - lastLine >= 2000) {
                lastLine = System.currentTimeMillis()
                line()
            }
            reportKidsTime()
            updateAction()
            main.postDelayed(this, 1000)
        }
    }
    private var lastReport = 0L
    private var lastKidsReport = 0L
    private var kidsWarned = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildViews()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, view).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        start(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        report("stop")
        reportWatching("stop")
        leaveSync()
        start(intent)
    }

    private fun start(intent: Intent) {
        val gson = hub.gson
        req = intent.getStringExtra(EXTRA_REQ)?.let { gson.fromJson(it, PlaybackRequest::class.java) }
        ref = intent.getStringExtra(EXTRA_TITLE)?.let { gson.fromJson(it, TitleRef::class.java) }
        startOverride = intent.getLongExtra(EXTRA_START, -1L)
        intent.getStringExtra(EXTRA_SYNC)?.let { id -> scope.launch { joinGroup(id, quiet = true) } }
        val offlineId = intent.getStringExtra(EXTRA_OFFLINE)
        if (offlineId != null) {
            val entry = Offline.entry(offlineId) ?: return finishWith("That download has gone.")
            offline = entry
            info = null
            ref = entry.item.ref ?: ref
            progressKey = entry.item.progressKey
            live = false
            remembered = null
            rememberedApplied = true
            show(entry.item.title, entry.item.subtitle)
            val resume = Offline.position(progressKey)?.let { p -> if (p.durationMs != null && p.positionMs > p.durationMs * 0.95) 0L else p.positionMs } ?: 0L
            open(listOf(Offline.mediaItem(entry)), resume, null)
        } else {
            val i = intent.getStringExtra(EXTRA_INFO)?.let { gson.fromJson(it, PlaybackInfo::class.java) } ?: return finishWith("Nothing to play.")
            offline = null
            playInfo(i)
        }
    }

    private fun playInfo(i: PlaybackInfo) {
        info = i
        progressKey = i.progressKey
        live = i.live
        reported = false
        loadRemembered()
        show(i.title, i.subtitle)
        val subs = i.externalSubtitles.orEmpty().map { s ->
            val ext = Regex("\\.(srt|ass|ssa|vtt)(\\?|$)", RegexOption.IGNORE_CASE).find(s.url)?.groupValues?.get(1)?.lowercase()
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(hub.abs(s.url)))
                .setMimeType(if (ext == "vtt") MimeTypes.TEXT_VTT else if (ext == "ass" || ext == "ssa") MimeTypes.TEXT_SSA else MimeTypes.APPLICATION_SUBRIP)
                .setLanguage(s.lang).setLabel(s.label).build()
        }
        fun item(url: String) = MediaItem.Builder().setUri(hub.abs(url)).apply {
            if (i.hls == true) setMimeType(MimeTypes.APPLICATION_M3U8)
            if (url == i.url) setSubtitleConfigurations(subs)
        }.build()
        val items = listOf(item(i.url)) + i.queue.orEmpty().map { item(it) }
        // Downloaded already? Play the saved copy's position if the Hub doesn't know a newer one.
        val local = Offline.position(i.progressKey)
        val start = when {
            i.live -> 0L
            // Carrying on from another screen, or joining Sync play: from where that has got to.
            startOverride >= 0 -> startOverride.also { startOverride = -1L }
            local != null && (i.startMs ?: 0) == 0L && local.positionMs > 0 -> local.positionMs
            else -> i.startMs ?: 0L
        }
        open(items, start, i.headers)
    }

    private fun open(items: List<MediaItem>, startMs: Long, headers: Map<String, String>?) {
        player?.release()
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("UltimateTV-Android")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(headers.orEmpty())
        val source = if (offline != null) Offline.cacheReader(this) else DefaultDataSource.Factory(this, http)
        // IPTV streams often start between keyframes; the Hub's recordings and live relay are TS.
        val extractors = DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)
            .setConstantBitrateSeekingEnabled(true)
        // Hardware decoders first; FFmpeg only for what the phone can't do itself.
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)
        // Never pick a track the screen or decoder can't use, and start playing sooner: ExoPlayer's
        // default waits for 2.5 s of video before the first frame, which on a stick means a long
        // spinner for a high-bitrate file. 1 s to start (and 2 s after a stall) is plenty.
        val caps = DeviceProfile.current(this, App.instance.prefs)
        val selector = DefaultTrackSelector(this).apply {
            parameters = buildUponParameters()
                .setMaxVideoSize(caps.maxHeight * 16 / 9 + 16, caps.maxHeight)
                .setMaxVideoBitrate(caps.maxBitrateKbps * 1000)
                .setExceedVideoConstraintsIfNecessary(true)
                .setExceedRendererCapabilitiesIfNecessary(false)
                .build()
        }
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, 50_000, 1_000, 2_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        val p = ExoPlayer.Builder(this, renderers)
            .setTrackSelector(selector)
            .setLoadControl(load)
            .setMediaSourceFactory(DefaultMediaSourceFactory(source, extractors))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(30_000)
            .build()
        player = p
        view.player = p
        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) = failed(error)
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && !reported) {
                    reported = true
                    report("start")
                    reportWatching("start")
                    line()
                }
                if (state == Player.STATE_ENDED) ended()
            }

            // Pause, play and seek pressed here go to everyone in Sync play.
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) tellGroup(if (playWhenReady) "play" else "pause", p.currentPosition)
            }

            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                if (reason == Player.DISCONTINUITY_REASON_SEEK) tellGroup("seek", newPosition.positionMs)
            }
            override fun onTracksChanged(tracks: Tracks) = applyRemembered()
        })
        p.setMediaItems(items, 0, startMs)
        p.prepare()
        p.playWhenReady = true
        main.removeCallbacks(ticker)
        main.post(ticker)
    }

    private fun failed(error: PlaybackException) {
        val cause = error.cause
        val message = when {
            cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode == 409 -> "The IPTV connection was needed elsewhere (a recording, or the TV changed channel)."
            cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode == 404 -> "This stream has expired. Start it again."
            cause is HttpDataSource.HttpDataSourceException -> if (offline != null) "This download isn't complete yet." else "Lost the connection to the Hub. Are you on the home Wi-Fi?"
            error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED || error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ->
                "This ${if (DeviceProfile.isFireTv(this)) "Fire TV" else "device"} can't decode this version. Pick a 1080p version under Versions."
            else -> error.message ?: "Playback stopped."
        }
        AlertDialog.Builder(this)
            .setTitle("Can't play this")
            .setMessage(message)
            .setPositiveButton("Close") { _, _ -> finish() }
            .apply { if (live || offline == null) setNeutralButton("Try again") { _, _ -> retry() } }
            .setOnCancelListener { finish() }
            .show()
    }

    /** Asks the Hub again: live streams and expired links get a fresh URL. */
    private fun retry() {
        val r = req ?: run {
            player?.prepare()
            return
        }
        scope.launch {
            runCatching { hub.play(r, force = true) }
                .onSuccess { playInfo(it) }
                .onFailure { finishWith(it.message ?: "Couldn't start it again.") }
        }
    }

    private fun ended() {
        report("stop")
        reportWatching("stop")
        val next = info?.next
        if (next != null) playNext(next)
        else if (live) retry()
        else finish()
    }

    private fun playNext(next: NextUp) {
        Toast.makeText(this, "Next: ${next.name}", Toast.LENGTH_SHORT).show()
        req = next.request()
        scope.launch {
            runCatching { hub.play(next.request()) }
                .onSuccess { playInfo(it) }
                .onFailure { finishWith(it.message ?: "Couldn't start the next episode.") }
        }
    }

    /** "Skip intro" over an intro or recap; "Next episode" over the credits or the last minute. */
    private fun updateAction() {
        val p = player ?: return
        val pos = p.currentPosition
        val i = info
        val marker = i?.skip.orEmpty().find { pos >= it.startMs && pos < it.endMs - 1000 }
        val nearEnd = !live && p.duration > 0 && p.duration - pos < 60_000
        when {
            marker != null && marker.kind != "credits" -> {
                action.text = if (marker.kind == "recap") "Skip recap" else "Skip intro"
                action.setOnClickListener { p.seekTo(marker.endMs) }
                action.visibility = View.VISIBLE
            }
            i?.next != null && (marker?.kind == "credits" || nearEnd) -> {
                action.text = "Next episode"
                action.setOnClickListener { report("stop"); playNext(i.next) }
                action.visibility = View.VISIBLE
            }
            else -> action.visibility = View.GONE
        }
    }

    private fun report(event: String) {
        val p = player ?: return
        if (live || progressKey.isEmpty() || progressKey.startsWith("channel:")) return
        val now = System.currentTimeMillis()
        if (event == "progress" && now - lastReport < 10_000) return
        lastReport = now
        val pos = p.currentPosition
        val dur = p.duration.takeIf { it > 0 } ?: info?.durationMs ?: offline?.item?.durationMs
        val paused = !p.isPlaying
        val key = progressKey
        val title = ref
        // Kept on the phone either way, so downloads resume where you left off.
        Offline.savePosition(key, pos, dur, title, sync = false)
        scope.launch {
            val ok = runCatching { hub.progress(key, pos, dur, event, paused, title) }.isSuccess
            if (!ok) Offline.savePosition(key, pos, dur, title, sync = true)
        }
    }

    /**
     * Kids profiles: the Hub counts the time from these reports and refuses anything new once it's
     * up. Here we warn at 5 and 2 minutes, and close the player when the Hub says to stop.
     */
    private fun reportKidsTime() {
        val now = System.currentTimeMillis()
        if (now - lastKidsReport < 30_000) return
        lastKidsReport = now
        val playing = player?.isPlaying == true
        scope.launch {
            val st = runCatching { hub.kidsReport(playing) }.getOrNull() ?: return@launch
            if (st["limited"] != true) return@launch
            val state = st["state"] as? String
            val left = (st["minutesLeft"] as? Number)?.toInt()
            val bedtime = st["reason"] == "bedtime"
            val key = "$state:${if (left != null && left <= 2) 2 else 5}"
            when {
                state == "stopped" -> {
                    player?.pause()
                    finishWith(if (bedtime) "It's bedtime. Ask a grown-up for more time." else "That's all the TV for today. Ask a grown-up for more time.")
                }
                state == "finishing" && kidsWarned != "finishing" -> {
                    kidsWarned = "finishing"
                    Toast.makeText(this@PlayerActivity, if (bedtime) "It's bedtime: this can finish, then that's it." else "Time's up: this can finish, then that's it.", Toast.LENGTH_LONG).show()
                }
                state == "warn" && left != null && kidsWarned != key -> {
                    kidsWarned = key
                    Toast.makeText(this@PlayerActivity, "$left more minute${if (left == 1) "" else "s"}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Watching elsewhere and Sync play (hub/src/watching.ts). Every few seconds the phone tells the
    // Hub what it's playing, so the TV (or a tablet) can carry on from here. The answer says if
    // another screen asked something of us: pause, stop (they've moved it to the TV) or join Sync
    // play. In Sync play the Hub keeps one clock for the group, and every member follows it.

    private var startOverride = -1L
    private var lastWatchReport = 0L
    private var lastLine = 0L
    private var watchStarted = false
    private var clockOffset = 0L
    private var myDevice: String? = null
    private var group: SyncGroup? = null
    private var groupPoll: Job? = null
    /** While we line up with the group, our own pause and seek aren't news to send back. */
    private var applyingUntil = 0L

    private fun hubNow() = System.currentTimeMillis() + clockOffset
    private fun learnClock(now: Long?) {
        if (now != null && now > 0) clockOffset = now - System.currentTimeMillis()
    }

    private fun sameReq(a: PlaybackRequest, b: PlaybackRequest) = a.kind == b.kind && a.id == b.id && (a.episodeId ?: "") == (b.episodeId ?: "")

    private fun watchBody(event: String): MutableMap<String, Any>? {
        val p = player ?: return null
        val r = req ?: return null
        // A download plays away from home: nothing to share.
        if (offline != null) return null
        val i = info
        val name = ref?.name ?: i?.title ?: return null
        val m = mutableMapOf<String, Any>(
            "req" to r,
            "name" to name,
            "live" to live,
            "positionMs" to maxOf(0L, p.currentPosition),
            "paused" to !p.playWhenReady,
            "event" to event,
            "client" to "android",
            "deviceName" to android.os.Build.MODEL,
        )
        val sub = i?.subtitle ?: i?.title?.takeIf { ref != null && it != ref?.name }
        sub?.let { m["subtitle"] = it }
        (ref?.backdrop ?: ref?.poster ?: i?.artwork ?: i?.logo)?.let { hub.abs(it) }?.let { m["artwork"] = it }
        ref?.let { m["title"] = it }
        (p.duration.takeIf { it > 0 } ?: i?.durationMs)?.let { m["durationMs"] = it }
        group?.takeIf { !it.ended }?.let { m["sync"] = it.id }
        return m
    }

    private fun reportWatching(event: String) {
        lastWatchReport = System.currentTimeMillis()
        if (event == "stop") {
            if (!watchStarted) return
            watchStarted = false
        }
        val body = watchBody(event) ?: return
        if (event != "stop") watchStarted = true
        after.launch {
            val reply = runCatching { hub.reportWatching(body) }.getOrNull() ?: return@launch
            learnClock(reply.now)
            reply.me?.let { myDevice = it }
            if (event == "stop" || isFinishing || isDestroyed) return@launch
            reply.commands.orEmpty().forEach { obey(it) }
            reply.sync?.let { follow(it) }
        }
    }

    private fun obey(c: WatchCommand) {
        when (c.type) {
            "pause" -> {
                applyingUntil = System.currentTimeMillis() + 1500
                player?.pause()
                Toast.makeText(this, "Paused from another screen", Toast.LENGTH_SHORT).show()
            }
            "stop" -> finishWith("Carried on on another screen")
            "sync" -> c.group?.let { id -> scope.launch { joinGroup(id, quiet = false) } }
        }
    }

    private suspend fun joinGroup(id: String, quiet: Boolean) {
        val reply = runCatching { hub.syncState(id, 0, 0) }.getOrNull() ?: return
        learnClock(reply.now)
        val g = reply.group ?: return
        follow(g)
        if (!quiet) {
            val others = g.members.orEmpty().filter { it.device != myDevice }.mapNotNull { it.deviceName }
            Toast.makeText(this, "Sync play with ${others.joinToString(" and ").ifEmpty { "another screen" }}: pausing or skipping on one does both", Toast.LENGTH_LONG).show()
        }
    }

    /** Takes the group's latest clock, lines up with it, and keeps listening for changes. */
    private fun follow(g: SyncGroup) {
        val before = group
        val me = myDevice
        val gone = g.ended || (me != null && g.members.orEmpty().none { it.device == me })
        if (gone) {
            if (before?.id == g.id) {
                group = null
                groupPoll?.cancel()
                Toast.makeText(this, "Sync play has ended", Toast.LENGTH_SHORT).show()
            }
            return
        }
        group = g
        if (before == null || before.seq != g.seq) {
            val last = g.last
            if (before?.id == g.id && last != null && last.device != me && last.action in setOf("play", "pause", "seek")) {
                val verb = when (last.action) { "pause" -> "paused"; "play" -> "pressed play"; else -> "skipped" }
                Toast.makeText(this, "${last.deviceName ?: "Another screen"} $verb", Toast.LENGTH_SHORT).show()
            }
            line()
        }
        if (groupPoll?.isActive != true) groupPoll = scope.launch { poll(g.id) }
    }

    /** Long-polls the group, so a pause on the TV pauses the phone within a moment. */
    private suspend fun poll(id: String) {
        while (group?.id == id) {
            val since = group?.seq ?: return
            val reply = try {
                hub.syncState(id, since, 20_000)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                if (e.status == 404) {
                    if (group?.id == id) {
                        group = null
                        Toast.makeText(this, "Sync play has ended", Toast.LENGTH_SHORT).show()
                    }
                    return
                }
                null
            } catch (e: Throwable) {
                null
            }
            if (reply == null) {
                delay(3000)
                continue
            }
            learnClock(reply.now)
            reply.group?.let { follow(it) }
        }
    }

    /** Moves the player to where the group's clock says, unless it's close enough already. */
    private fun line() {
        val g = group ?: return
        val p = player ?: return
        val r = req ?: return
        if (!sameReq(r, g.req) || p.playbackState != Player.STATE_READY) return
        if (!p.playWhenReady != g.paused) {
            applyingUntil = System.currentTimeMillis() + 2000
            p.playWhenReady = !g.paused
        }
        if (g.live) return
        val want = placeAt(g.positionMs, g.paused, g.at, g.durationMs, hubNow())
        val tolerance = if (g.paused) 1000L else 2500L
        if (abs(p.currentPosition - want) > tolerance) {
            applyingUntil = System.currentTimeMillis() + 2000
            p.seekTo(want)
        }
    }

    private fun tellGroup(action: String, positionMs: Long) {
        val g = group ?: return
        // Opening the file presses "play" too: only what happens once it's playing is news.
        if (!reported || System.currentTimeMillis() < applyingUntil) return
        val r = req ?: return
        if (!sameReq(r, g.req)) return
        scope.launch {
            val reply = runCatching { hub.syncAction(g.id, action, maxOf(0L, positionMs)) }.getOrNull() ?: return@launch
            learnClock(reply.now)
            reply.group?.let { if (!it.ended) group = it }
        }
    }

    private fun leaveSync() {
        val g = group ?: return
        group = null
        groupPoll?.cancel()
        after.launch { runCatching { hub.syncLeave(g.id) } }
    }

    /** The top bar's TV button: put what's playing here on the TV, or watch it on both together. */
    private fun toTv() {
        if (offline != null || req == null) {
            Toast.makeText(this, "A download plays on this phone only", Toast.LENGTH_SHORT).show()
            return
        }
        val inSync = group != null
        val choices = mutableListOf("Move to the TV (stop here)", "Sync play with the TV")
        if (inSync) choices += "Leave Sync play"
        AlertDialog.Builder(this)
            .setTitle("Watch on the TV")
            .setItems(choices.toTypedArray()) { _, which ->
                when (which) {
                    0 -> sendToTv("move")
                    1 -> sendToTv("sync")
                    2 -> {
                        leaveSync()
                        Toast.makeText(this, "Left Sync play: carrying on here on its own", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .show()
    }

    private fun sendToTv(mode: String) {
        // The Hub needs to know where we've got to before the TV asks it.
        reportWatching("progress")
        scope.launch {
            delay(600)
            val me = myDevice
            if (me == null) {
                Toast.makeText(this@PlayerActivity, "Pair this phone with the TV first: Settings › Pair with the TV", Toast.LENGTH_LONG).show()
                return@launch
            }
            Toast.makeText(this@PlayerActivity, if (mode == "move") "Moving it to the TV…" else "Starting it on the TV…", Toast.LENGTH_SHORT).show()
            runCatching { hub.tvWatchHere(me, mode) }
                .onSuccess { if (mode == "sync") Toast.makeText(this@PlayerActivity, "Sync play with the TV: pausing or skipping on one does both", Toast.LENGTH_LONG).show() }
                .onFailure { Toast.makeText(this@PlayerActivity, tv.ultimate.client.ui.explain(it), Toast.LENGTH_LONG).show() }
        }
    }

    // ---------------------------------------------------------------------
    // The remote. A Fire TV remote (and any TV remote) sends select, back, play/pause, rewind
    // and fast forward as key events, never as touches, so the player has to answer them here.
    // Handled in dispatchKeyEvent rather than onKeyDown so a press can never both seek and
    // move a button on the on-screen controller.

    private var controllerVisible = true

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val p = player ?: return super.dispatchKeyEvent(event)
        val down = event.action == KeyEvent.ACTION_DOWN
        // A press on a button of our own (Audio and subtitles, Skip intro) belongs to that button,
        // so Select clicks it and left/right/up/down move between buttons instead of seeking.
        if (onOwnButton() && event.keyCode in BUTTON_KEYS) return super.dispatchKeyEvent(event)
        return when (event.keyCode) {
            // The Fire remote's menu key, and Down, open Audio and subtitles (the bar's CC button
            // can't be reached by D-pad while Select means play/pause); Up focuses the button.
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (down) openTrackMenu()
                true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                if (down) {
                    view.showController()
                    topBar.visibility = View.VISIBLE
                    optionsButton.requestFocus()
                }
                true
            }
            // Play/pause: the remote's transport button, and Select on a D-pad.
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                if (down) togglePlay()
                true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY -> {
                if (down) p.play()
                true
            }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                if (down) p.pause()
                true
            }
            // A tap of rewind or fast forward steps back 10 seconds or on 30.
            KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_DPAD_LEFT -> {
                if (down) seekBy(-SEEK_BACK_MS)
                true
            }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (down) seekBy(SEEK_FORWARD_MS)
                true
            }
            // "Next" only means something when the Hub queued an episode up.
            KeyEvent.KEYCODE_MEDIA_NEXT -> {
                val next = info?.next
                if (down && next != null) {
                    report("stop")
                    playNext(next)
                }
                true
            }
            // Back hides the controller first, then leaves the player: on a TV, leaving on the
            // first press because an overlay happened to be up feels like a crash.
            KeyEvent.KEYCODE_BACK -> {
                if (down && controllerVisible) {
                    view.hideController()
                    true
                } else {
                    super.dispatchKeyEvent(event)
                }
            }
            else -> super.dispatchKeyEvent(event)
        }
    }

    private fun onOwnButton(): Boolean {
        val f = currentFocus ?: return false
        return f === optionsButton || f === action || (f.parent === topBar)
    }

    // ---------------------------------------------------------------------
    // Audio and subtitles, as a plain list a D-pad can walk (and Off for subtitles).

    private class TrackChoice(val group: Tracks.Group, val index: Int, val label: String, val lang: String?, val description: Boolean)

    private fun choices(type: Int): List<TrackChoice> {
        val p = player ?: return emptyList()
        val out = mutableListOf<TrackChoice>()
        for (g in p.currentTracks.groups) {
            if (g.type != type) continue
            for (i in 0 until g.length) {
                val f = g.getTrackFormat(i)
                val lang = f.language?.takeIf { it != "und" }
                val name = f.label ?: lang?.let { java.util.Locale(it).displayLanguage.takeIf { n -> n.isNotBlank() } } ?: "Track ${out.size + 1}"
                val extra = if (type == C.TRACK_TYPE_AUDIO && f.channelCount > 2) " ${f.channelCount - 1}.1" else ""
                val description = (f.roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO) != 0
                out.add(TrackChoice(g, i, name + extra + (if (description) " (audio description)" else ""), lang, description))
            }
        }
        return out
    }

    private fun isOn(c: TrackChoice) = c.group.isTrackSelected(c.index)

    private fun openTrackMenu() {
        val p = player ?: return
        if (isFinishing) return
        val audio = choices(C.TRACK_TYPE_AUDIO)
        val subs = choices(C.TRACK_TYPE_TEXT)
        val subsOn = !p.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) && subs.any { isOn(it) }
        val entries = mutableListOf<Pair<String, () -> Unit>>()
        entries.add("Subtitles: " + (if (subsOn) subs.first { isOn(it) }.label else "Off") to { pickSubtitle(subs, subsOn) })
        entries.add("Sound: " + (audio.firstOrNull { isOn(it) }?.label ?: "Default") to { pickAudio(audio) })
        if (rememberKey() != null) entries.add("Default: forget my choice for this series" to { forgetChoice() })
        AlertDialog.Builder(this)
            .setTitle("Audio and subtitles")
            .setItems(entries.map { it.first }.toTypedArray()) { _, which -> entries[which].second() }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun pickSubtitle(subs: List<TrackChoice>, subsOn: Boolean) {
        val labels = listOf("Off") + subs.map { it.label }
        val checked = if (!subsOn) 0 else subs.indexOfFirst { isOn(it) } + 1
        AlertDialog.Builder(this)
            .setTitle("Subtitles")
            .setSingleChoiceItems(labels.toTypedArray(), checked) { d, which ->
                if (which == 0) setSubtitle(null) else setSubtitle(subs[which - 1])
                d.dismiss()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun pickAudio(audio: List<TrackChoice>) {
        if (audio.isEmpty()) return
        AlertDialog.Builder(this)
            .setTitle("Sound")
            .setSingleChoiceItems(audio.map { it.label }.toTypedArray(), audio.indexOfFirst { isOn(it) }) { d, which ->
                setAudio(audio[which])
                d.dismiss()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun setSubtitle(choice: TrackChoice?, remember: Boolean = true) {
        val p = player ?: return
        val b = p.trackSelectionParameters.buildUpon()
        if (choice == null) {
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            b.setOverrideForType(TrackSelectionOverride(choice.group.mediaTrackGroup, choice.index))
        }
        p.trackSelectionParameters = b.build()
        if (remember) remember(subtitleOff = choice == null, subtitleLang = choice?.lang, audio = null)
    }

    private fun setAudio(choice: TrackChoice, remember: Boolean = true) {
        val p = player ?: return
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(choice.group.mediaTrackGroup, choice.index)).build()
        if (remember) remember(subtitleOff = false, subtitleLang = null, audio = choice)
    }

    // ---------------------------------------------------------------------
    // Remembered choice per series (issue #228): a language, matched on whichever source plays.

    private fun rememberKey(): String? = req?.takeIf { it.kind == "title" && !live }?.id

    /** "eng", "en" and "en-GB" are one language; the Hub stores the two-letter form. */
    private fun lang2(l: String?): String {
        val c = l.orEmpty().lowercase()
        return when (c.take(3)) {
            "eng" -> "en"; "jpn" -> "ja"; "fra", "fre" -> "fr"; "deu", "ger" -> "de"; "spa" -> "es"; "ita" -> "it"
            "por" -> "pt"; "nld", "dut" -> "nl"; "rus" -> "ru"; "kor" -> "ko"; "zho", "chi" -> "zh"; "pol" -> "pl"
            else -> c.take(2)
        }
    }

    private fun remember(subtitleOff: Boolean, subtitleLang: String?, audio: TrackChoice?) {
        val key = rememberKey() ?: return
        val audioLang = audio?.lang
        if (!subtitleOff && subtitleLang == null && audioLang == null) return
        scope.launch { runCatching { hub.saveTrackPref(key, audioLang, audio?.description == true, subtitleLang, subtitleOff) } }
    }

    private fun forgetChoice() {
        val key = rememberKey() ?: return
        remembered = null
        scope.launch { runCatching { hub.clearTrackPref(key) } }
        Toast.makeText(this, "Back to your usual sound and subtitles from the next episode", Toast.LENGTH_LONG).show()
    }

    private fun loadRemembered() {
        remembered = null
        rememberedApplied = true
        val key = rememberKey() ?: return
        scope.launch {
            val pref = runCatching { hub.trackPref(key) }.getOrNull() ?: return@launch
            remembered = pref
            rememberedApplied = false
            applyRemembered()
        }
    }

    /** Picks the remembered sound and subtitles once the player lists its tracks; once per title. */
    private fun applyRemembered() {
        val pref = remembered ?: return
        if (rememberedApplied || player == null) return
        val audio = choices(C.TRACK_TYPE_AUDIO)
        if (audio.isEmpty()) return
        rememberedApplied = true
        pref.audio?.let { want ->
            val same = audio.filter { lang2(it.lang) == lang2(want.lang) }
            val pick = same.firstOrNull { it.description == (want.description == true) } ?: if (want.description == true) null else same.firstOrNull()
            if (pick != null && !isOn(pick)) setAudio(pick, remember = false)
        }
        if (pref.subtitleOff) {
            setSubtitle(null, remember = false)
        } else {
            val lang = pref.subtitleLang
            val pick = lang?.let { l -> choices(C.TRACK_TYPE_TEXT).firstOrNull { lang2(it.lang) == lang2(l) } }
            if (pick != null) setSubtitle(pick, remember = false)
        }
    }

    private fun togglePlay() {
        val p = player ?: return
        if (p.isPlaying) p.pause() else p.play()
        // A press of pause with the controller hidden should show what happened.
        if (!controllerVisible) view.showController()
    }

    private fun seekBy(byMs: Long) {
        val p = player ?: return
        val end = if (p.duration > 0) p.duration else Long.MAX_VALUE
        p.seekTo((p.currentPosition + byMs).coerceIn(0L, end))
        if (!controllerVisible) view.showController()
    }

    // ---------------------------------------------------------------------
    // Picture-in-picture: carry on watching in a corner when you leave the app.

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (player?.isPlaying == true) {
            runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        view.useController = !isInPictureInPictureMode
        if (isInPictureInPictureMode) {
            topBar.visibility = View.GONE
            action.visibility = View.GONE
        }
    }

    override fun onStop() {
        super.onStop()
        // Closing the picture-in-picture window stops the activity: stop playing too.
        if (!isInPictureInPictureMode) player?.pause()
        report("stop")
    }

    override fun onDestroy() {
        main.removeCallbacks(ticker)
        report("stop")
        reportWatching("stop")
        leaveSync()
        player?.release()
        player = null
        scope.cancel()
        super.onDestroy()
    }

    private fun finishWith(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        finish()
    }

    // ---------------------------------------------------------------------

    private fun show(title: String, subtitle: String?) {
        titleView.text = title
        subtitleView.text = subtitle.orEmpty()
        subtitleView.visibility = if (subtitle.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun buildViews() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        view = PlayerView(this).apply {
            keepScreenOn = true
            setShowSubtitleButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
            setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v ->
                controllerVisible = v == View.VISIBLE
                topBar.visibility = v
            })
        }
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(16), dp(24), dp(28))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xCC000000.toInt(), 0x00000000))
        }
        val back = ImageButton(this).apply {
            setImageResource(R.drawable.ic_back)
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Back"
            setOnClickListener { finish() }
        }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(8), 0, 0, 0) }
        titleView = TextView(this).apply { setTextColor(Color.WHITE); textSize = 18f; typeface = Typeface.DEFAULT_BOLD; maxLines = 1 }
        subtitleView = TextView(this).apply { setTextColor(0xFFC8D0E0.toInt()); textSize = 14f; maxLines = 1 }
        texts.addView(titleView)
        texts.addView(subtitleView)
        // Reachable by the Fire remote: Up from the picture lands here, Select opens the list.
        optionsButton = Button(this).apply {
            text = "Audio and subtitles"
            isAllCaps = false
            textSize = 14f
            isFocusable = true
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply { setColor(0x55FFFFFF); cornerRadius = dp(20).toFloat() }
            setPadding(dp(18), 0, dp(18), 0)
            setOnClickListener { openTrackMenu() }
            setOnFocusChangeListener { v, focused -> v.background = GradientDrawable().apply { setColor(if (focused) 0xFFFFFFFF.toInt() else 0x55FFFFFF); cornerRadius = dp(20).toFloat() }; (v as Button).setTextColor(if (focused) Color.BLACK else Color.WHITE) }
        }
        // Watch on the TV: move it there, or Sync play on both.
        val tvButton = ImageButton(this).apply {
            setImageResource(R.drawable.ic_screens)
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Watch on the TV"
            setOnClickListener { toTv() }
        }
        topBar.addView(back, LinearLayout.LayoutParams(dp(44), dp(44)))
        topBar.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        topBar.addView(optionsButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(40)))
        topBar.addView(tvButton, LinearLayout.LayoutParams(dp(44), dp(44)))
        root.addView(topBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        action = Button(this).apply {
            visibility = View.GONE
            setTextColor(Color.BLACK)
            isAllCaps = false
            textSize = 15f
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(22).toFloat() }
            setPadding(dp(22), 0, dp(22), 0)
        }
        root.addView(action, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(24), dp(96)) })
        setContentView(root)
    }

    companion object {
        const val EXTRA_INFO = "info"
        const val EXTRA_REQ = "req"
        const val EXTRA_TITLE = "title"
        const val EXTRA_OFFLINE = "offline"
        /** Start here (ms) instead of the resume point: carrying on from another screen. */
        const val EXTRA_START = "startMs"
        /** Join this Sync play group once playing. */
        const val EXTRA_SYNC = "sync"
        private const val WATCH_REPORT_MS = 5_000L

        /** A tap of rewind, and of fast forward, on a TV remote. */
        private const val SEEK_BACK_MS = 10_000L
        private const val SEEK_FORWARD_MS = 30_000L

        /** Keys a focused button of ours handles itself: Select, and moving between buttons. */
        private val BUTTON_KEYS = setOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN)

        fun play(context: Context, info: PlaybackInfo, req: PlaybackRequest, title: TitleRef?, startMs: Long? = null, sync: String? = null) {
            val gson = App.instance.hub.gson
            context.startActivity(Intent(context, PlayerActivity::class.java).apply {
                putExtra(EXTRA_INFO, gson.toJson(info))
                putExtra(EXTRA_REQ, gson.toJson(req))
                title?.let { putExtra(EXTRA_TITLE, gson.toJson(it)) }
                startMs?.let { putExtra(EXTRA_START, it) }
                sync?.let { putExtra(EXTRA_SYNC, it) }
            })
        }

        fun playOffline(context: Context, entry: OfflineEntry) {
            context.startActivity(Intent(context, PlayerActivity::class.java).putExtra(EXTRA_OFFLINE, entry.item.id))
        }
    }
}

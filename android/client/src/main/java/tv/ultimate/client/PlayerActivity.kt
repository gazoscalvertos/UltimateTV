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
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class PlayerActivity : ComponentActivity() {
    private val scope = MainScope()
    private val main = Handler(Looper.getMainLooper())
    private val hub get() = App.instance.hub

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private lateinit var topBar: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var subtitleView: TextView
    private lateinit var action: Button

    private var info: PlaybackInfo? = null
    private var req: PlaybackRequest? = null
    private var ref: TitleRef? = null
    private var offline: OfflineEntry? = null
    private var progressKey: String = ""
    private var live = false
    private var reported = false

    private val ticker = object : Runnable {
        override fun run() {
            report("progress")
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
        start(intent)
    }

    private fun start(intent: Intent) {
        val gson = hub.gson
        req = intent.getStringExtra(EXTRA_REQ)?.let { gson.fromJson(it, PlaybackRequest::class.java) }
        ref = intent.getStringExtra(EXTRA_TITLE)?.let { gson.fromJson(it, TitleRef::class.java) }
        val offlineId = intent.getStringExtra(EXTRA_OFFLINE)
        if (offlineId != null) {
            val entry = Offline.entry(offlineId) ?: return finishWith("That download has gone.")
            offline = entry
            info = null
            ref = entry.item.ref ?: ref
            progressKey = entry.item.progressKey
            live = false
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
        val p = ExoPlayer.Builder(this, renderers)
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
                }
                if (state == Player.STATE_ENDED) ended()
            }
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
                "This phone can't decode this version. Try another version, or a smaller copy."
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
            setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> topBar.visibility = v })
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
        topBar.addView(back, LinearLayout.LayoutParams(dp(44), dp(44)))
        topBar.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
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

        fun play(context: Context, info: PlaybackInfo, req: PlaybackRequest, title: TitleRef?) {
            val gson = App.instance.hub.gson
            context.startActivity(Intent(context, PlayerActivity::class.java).apply {
                putExtra(EXTRA_INFO, gson.toJson(info))
                putExtra(EXTRA_REQ, gson.toJson(req))
                title?.let { putExtra(EXTRA_TITLE, gson.toJson(it)) }
            })
        }

        fun playOffline(context: Context, entry: OfflineEntry) {
            context.startActivity(Intent(context, PlayerActivity::class.java).putExtra(EXTRA_OFFLINE, entry.item.id))
        }
    }
}

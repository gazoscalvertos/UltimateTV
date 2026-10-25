// Downloads for watching away from home. Media3's download manager saves the file (or Jellyfin's
// smaller HLS copy) into the app's own storage, resumes after a dropped connection or a reboot, and
// waits for Wi-Fi when asked. The artwork and subtitles are saved beside it so the Downloads tab
// works with no network at all. Where you got to is kept on the phone and sent to the Hub (and so
// Jellyfin and the TV) the next time the phone is home.

package tv.ultimate.client

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** What the Downloads tab shows for one download, saved with it (Media3 keeps it as the request's data). */
data class OfflineItem(
    val id: String,
    val title: String,
    val subtitle: String?,
    /** "movie", "episode" or "recording". */
    val kind: String,
    val titleId: String?,
    val episodeId: String?,
    val showName: String?,
    val season: Int?,
    val episode: Int?,
    val progressKey: String,
    val durationMs: Long?,
    /** Saved artwork on the phone. */
    val artwork: String?,
    val subtitles: List<OfflineSubtitle>?,
    val hls: Boolean?,
    val sizeBytes: Long?,
    val quality: String?,
    val headers: Map<String, String>?,
    val url: String,
    val addedAt: Long,
    val ref: TitleRef?,
)

data class OfflineSubtitle(val path: String, val lang: String?, val label: String?, val mime: String)

/** One row of the Downloads tab. */
data class OfflineEntry(
    val item: OfflineItem,
    val state: Int,
    val percent: Float,
    val bytes: Long,
    val failure: Boolean,
    val waitingFor: Int,
) {
    val done get() = state == Download.STATE_COMPLETED
}

data class Position(val positionMs: Long, val durationMs: Long?, val at: Long, val ref: TitleRef?)

object Offline {
    private lateinit var appContext: Context
    private lateinit var prefs: Prefs
    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ticker: Job? = null
    /** Request headers some sources need, by URL (Media3 keeps only the URL with a download). */
    private val headers = ConcurrentHashMap<String, Map<String, String>>()

    lateinit var cache: SimpleCache
        private set
    lateinit var manager: DownloadManager
        private set
    lateinit var notifications: DownloadNotificationHelper
        private set
    private lateinit var http: DefaultHttpDataSource.Factory

    private val _entries = MutableStateFlow<List<OfflineEntry>>(emptyList())
    val entries: StateFlow<List<OfflineEntry>> = _entries

    const val CHANNEL = "downloads"

    fun init(context: Context, prefs: Prefs) {
        if (::manager.isInitialized) return
        appContext = context.applicationContext
        this.prefs = prefs
        val root = appContext.getExternalFilesDir(null) ?: appContext.filesDir
        val db = StandaloneDatabaseProvider(appContext)
        cache = SimpleCache(File(root, "media"), NoOpCacheEvictor(), db)
        http = DefaultHttpDataSource.Factory().setUserAgent("UltimateTV-Android").setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(15_000).setReadTimeoutMs(30_000)
        val upstream = ResolvingDataSource.Factory(http) { spec ->
            val h = headers[spec.uri.toString()]
            if (h.isNullOrEmpty()) spec else spec.withAdditionalHeaders(h)
        }
        manager = DownloadManager(appContext, db, cache, upstream, Executors.newFixedThreadPool(3))
        manager.maxParallelDownloads = 2
        applyRequirements()
        notifications = DownloadNotificationHelper(appContext, CHANNEL)
        manager.addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) = refresh()
            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) {
                folderFor(download.request.id).deleteRecursively()
                refresh()
            }
            override fun onInitialized(downloadManager: DownloadManager) = refresh()
            override fun onRequirementsStateChanged(downloadManager: DownloadManager, requirements: Requirements, notMetRequirements: Int) = refresh()
        })
        refresh()
    }

    fun applyRequirements() {
        manager.requirements = Requirements(if (prefs.wifiOnly) Requirements.NETWORK_UNMETERED else Requirements.NETWORK)
    }

    /** Re-reads the download list, and keeps doing so every second while something is downloading. */
    fun refresh() {
        scope.launch(Dispatchers.IO) {
            val list = mutableListOf<OfflineEntry>()
            manager.downloadIndex.getDownloads().use { c ->
                while (c.moveToNext()) {
                    val d = c.download
                    val item = itemOf(d) ?: continue
                    item.headers?.let { if (it.isNotEmpty()) headers[item.url] = it }
                    list += OfflineEntry(item, d.state, d.percentDownloaded.coerceAtLeast(0f), d.bytesDownloaded, d.state == Download.STATE_FAILED, manager.notMetRequirements)
                }
            }
            list.sortByDescending { it.item.addedAt }
            _entries.value = list
            val busy = list.any { it.state == Download.STATE_DOWNLOADING || it.state == Download.STATE_QUEUED || it.state == Download.STATE_RESTARTING }
            launch(Dispatchers.Main) {
                if (busy && ticker?.isActive != true) {
                    ticker = scope.launch {
                        while (isActive) {
                            delay(1000)
                            refresh()
                        }
                    }
                } else if (!busy) {
                    ticker?.cancel()
                    ticker = null
                }
            }
        }
    }

    private fun itemOf(d: Download): OfflineItem? = runCatching { gson.fromJson(String(d.request.data), OfflineItem::class.java) }.getOrNull()

    fun entry(id: String): OfflineEntry? = _entries.value.find { it.item.id == id } ?: manager.downloadIndex.getDownload(id)?.let { d ->
        itemOf(d)?.let { OfflineEntry(it, d.state, d.percentDownloaded, d.bytesDownloaded, d.state == Download.STATE_FAILED, 0) }
    }

    /** Downloads by the progress key they report to, for the "Downloaded" ticks in the app. */
    fun byKey(key: String): OfflineEntry? = _entries.value.find { it.item.progressKey == key }

    private fun folderFor(id: String): File = File(appContext.filesDir, "offline/${hash(id)}")

    private fun hash(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)

    /** Saves the artwork and subtitles, then hands the video to the download service. */
    suspend fun add(hub: Hub, info: PlaybackInfo, meta: OfflineMeta) {
        val id = info.progressKey + if (info.hls == true) "|small" else ""
        val folder = folderFor(id)
        folder.mkdirs()
        val art = meta.artwork ?: info.artwork
        val artFile = File(folder, "art.jpg")
        val savedArt = art != null && hub.fetchTo(art, artFile)
        val subs = info.externalSubtitles.orEmpty().mapIndexedNotNull { i, s ->
            val ext = Regex("\\.(srt|ass|ssa|vtt)(\\?|$)", RegexOption.IGNORE_CASE).find(s.url)?.groupValues?.get(1)?.lowercase() ?: "srt"
            val f = File(folder, "sub$i.$ext")
            if (hub.fetchTo(s.url, f)) OfflineSubtitle(f.absolutePath, s.lang, s.label, mimeFor(ext)) else null
        }
        val q = info.quality
        val item = OfflineItem(
            id = id,
            title = meta.title ?: info.title,
            subtitle = meta.subtitle ?: info.subtitle,
            kind = meta.kind,
            titleId = meta.titleId,
            episodeId = meta.episodeId,
            showName = meta.showName,
            season = meta.season,
            episode = meta.episode,
            progressKey = info.progressKey,
            durationMs = info.durationMs,
            artwork = if (savedArt) artFile.absolutePath else null,
            subtitles = subs,
            hls = info.hls == true,
            sizeBytes = q?.sizeBytes,
            quality = qualityLabel(q, info.hls == true),
            headers = info.headers,
            url = info.url,
            addedAt = System.currentTimeMillis(),
            ref = meta.ref,
        )
        info.headers?.let { if (it.isNotEmpty()) headers[info.url] = it }
        val request = DownloadRequest.Builder(id, Uri.parse(info.url))
            .setMimeType(if (info.hls == true) MimeTypes.APPLICATION_M3U8 else null)
            .apply { if (info.hls != true) setCustomCacheKey(id) }
            .setData(gson.toJson(item).toByteArray())
            .build()
        DownloadService.sendAddDownload(appContext, DownloadsService::class.java, request, false)
        // Remember where it was resumed from on the TV, so the phone starts in the same place.
        info.startMs?.let { if (it > 0 && position(info.progressKey) == null) savePosition(info.progressKey, it, info.durationMs, meta.ref, sync = false) }
    }

    fun remove(id: String) = DownloadService.sendRemoveDownload(appContext, DownloadsService::class.java, id, false)

    fun retry(entry: OfflineEntry) {
        // A failed download keeps its request: adding it again picks up where it stopped.
        val d = manager.downloadIndex.getDownload(entry.item.id) ?: return
        DownloadService.sendAddDownload(appContext, DownloadsService::class.java, d.request, false)
    }

    fun pause(paused: Boolean) {
        if (paused) DownloadService.sendPauseDownloads(appContext, DownloadsService::class.java, false)
        else DownloadService.sendResumeDownloads(appContext, DownloadsService::class.java, false)
    }

    val paused: Boolean get() = manager.downloadsPaused

    fun usedBytes(): Long = runCatching { cache.cacheSpace }.getOrDefault(0L)
    fun freeBytes(): Long = (appContext.getExternalFilesDir(null) ?: appContext.filesDir).usableSpace

    /** The saved copy as something the player can open. */
    fun mediaItem(entry: OfflineEntry): MediaItem {
        val d = manager.downloadIndex.getDownload(entry.item.id)
        val base = d?.request?.toMediaItem() ?: MediaItem.fromUri(entry.item.url)
        val subs = entry.item.subtitles.orEmpty().map {
            MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(File(it.path))).setMimeType(it.mime).setLanguage(it.lang).setLabel(it.label).build()
        }
        return base.buildUpon().setSubtitleConfigurations(subs).build()
    }

    /** Reads saved copies first; anything else (subtitle files, the network) goes upstream. */
    fun cacheReader(context: Context): DataSource.Factory =
        CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(DefaultDataSource.Factory(context, http)).setCacheWriteDataSinkFactory(null)

    // ---------------------------------------------------------------------
    // Where you got to

    private val positionsPrefs get() = appContext.getSharedPreferences("positions", Context.MODE_PRIVATE)

    fun position(key: String): Position? = positionsPrefs.getString(key, null)?.let { runCatching { gson.fromJson(it, Position::class.java) }.getOrNull() }

    fun savePosition(key: String, positionMs: Long, durationMs: Long?, ref: TitleRef?, sync: Boolean = true) {
        val e = positionsPrefs.edit().putString(key, gson.toJson(Position(positionMs, durationMs, System.currentTimeMillis(), ref)))
        if (sync) {
            val pending = pendingKeys() + key
            e.putString("__pending", gson.toJson(pending))
        }
        e.apply()
    }

    private fun pendingKeys(): Set<String> = positionsPrefs.getString("__pending", null)?.let { runCatching { gson.fromJson<Set<String>>(it, object : TypeToken<Set<String>>() {}.type) }.getOrNull() } ?: emptySet()

    /** Sends what was watched offline to the Hub. Called whenever the Hub answers again. */
    suspend fun syncPositions(hub: Hub) {
        val pending = pendingKeys()
        if (pending.isEmpty()) return
        val left = pending.toMutableSet()
        for (key in pending) {
            val p = position(key)
            if (p == null) {
                left -= key
                continue
            }
            val ok = runCatching { hub.progress(key, p.positionMs, p.durationMs, "stop", false, p.ref) }.isSuccess
            if (ok) left -= key
        }
        positionsPrefs.edit().putString("__pending", gson.toJson(left)).apply()
    }

    private fun mimeFor(ext: String) = when (ext) {
        "vtt" -> MimeTypes.TEXT_VTT
        "ass", "ssa" -> MimeTypes.TEXT_SSA
        else -> MimeTypes.APPLICATION_SUBRIP
    }

    private fun qualityLabel(q: StreamQuality?, hls: Boolean): String? {
        if (hls) return "720p (smaller copy)"
        val h = q?.height ?: return null
        return when {
            h >= 2000 -> "4K"
            h >= 1000 -> "1080p"
            h >= 700 -> "720p"
            h > 0 -> "SD"
            else -> null
        }
    }
}

/** What the app knows about a download beyond what the Hub's playback answer says. */
data class OfflineMeta(
    val kind: String,
    val title: String? = null,
    val subtitle: String? = null,
    val titleId: String? = null,
    val episodeId: String? = null,
    val showName: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val artwork: String? = null,
    val ref: TitleRef? = null,
)

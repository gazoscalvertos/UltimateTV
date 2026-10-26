// Talks to the Hub on the home network. Every request says which profile is watching (so Kids
// only sees what it's allowed) and which phone this is (so it can share the IPTV connection).

package tv.ultimate.client

import android.content.Context
import android.net.Uri
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class ApiError(val status: Int, message: String, val code: String?) : Exception(message)

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("client", Context.MODE_PRIVATE)

    var hub: String
        get() = sp.getString("hub", DEFAULT_HUB) ?: DEFAULT_HUB
        set(v) = sp.edit().putString("hub", v.trim().trimEnd('/')).apply()
    var profileId: String?
        get() = sp.getString("profile", null)
        set(v) { sp.edit().putString("profile", v).commit() }
    var profileToken: String?
        get() = sp.getString("token", null)
        set(v) { sp.edit().putString("token", v).commit() }
    var profileName: String?
        get() = sp.getString("profileName", null)
        set(v) { sp.edit().putString("profileName", v).commit() }
    var profileKind: String?
        get() = sp.getString("profileKind", null)
        set(v) { sp.edit().putString("profileKind", v).commit() }
    /** The household's name for the app (Settings on the Hub), remembered for when it's away. */
    var appName: String
        get() = sp.getString("appName", null) ?: "UltimateTV"
        set(v) = sp.edit().putString("appName", v).apply()
    /** Downloads wait for Wi-Fi (on by default: a film is several gigabytes). */
    var wifiOnly: Boolean
        get() = sp.getBoolean("wifiOnly", true)
        set(v) = sp.edit().putBoolean("wifiOnly", v).apply()
    /** Ask Jellyfin for a 720p copy instead of the original file. */
    var smaller: Boolean
        get() = sp.getBoolean("smaller", false)
        set(v) = sp.edit().putBoolean("smaller", v).apply()
    val device: String
        get() = sp.getString("device", null) ?: "phone:${UUID.randomUUID().toString().replace("-", "").take(12)}".also { sp.edit().putString("device", it).apply() }

    companion object {
        const val DEFAULT_HUB = "http://192.168.0.19:8095"
    }
}

class Hub(private val prefs: Prefs) {
    val gson = Gson()

    val base: String get() = prefs.hub

    /** Hub paths ("/api/art/…") made absolute; full URLs left alone. */
    fun abs(url: String?): String? = when {
        url.isNullOrBlank() -> null
        url.startsWith("/") -> base + url
        else -> url
    }

    private fun open(path: String, method: String, body: Any?, timeoutMs: Int): HttpURLConnection {
        val c = URL(if (path.startsWith("http")) path else base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = minOf(timeoutMs, 6000)
        c.readTimeout = timeoutMs
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("X-Device", prefs.device)
        prefs.profileId?.let { c.setRequestProperty("X-Profile", it) }
        prefs.profileToken?.let { c.setRequestProperty("X-Profile-Token", it) }
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(gson.toJson(body).toByteArray()) }
        }
        return c
    }

    suspend fun raw(path: String, method: String = "GET", body: Any? = null, timeoutMs: Int = 30_000): String = withContext(Dispatchers.IO) {
        val c = open(path, method, body, timeoutMs)
        try {
            val status = c.responseCode
            val text = (if (status >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (status >= 400) {
                val json = runCatching { gson.fromJson(text, JsonObject::class.java) }.getOrNull()
                val message = json?.get("error")?.takeIf { it.isJsonPrimitive }?.asString ?: "The Hub said $status"
                val code = json?.get("code")?.takeIf { it.isJsonPrimitive }?.asString
                throw ApiError(status, message, code)
            }
            text
        } finally {
            c.disconnect()
        }
    }

    suspend inline fun <reified T> get(path: String, timeoutMs: Int = 30_000): T =
        gson.fromJson(raw(path, timeoutMs = timeoutMs), object : TypeToken<T>() {}.type)

    suspend inline fun <reified T> post(path: String, body: Any?, method: String = "POST", timeoutMs: Int = 60_000): T =
        gson.fromJson(raw(path, method, body ?: emptyMap<String, String>(), timeoutMs), object : TypeToken<T>() {}.type)

    /** True when the Hub answers: at home on Wi-Fi. */
    suspend fun reachable(): Boolean = runCatching { raw("/api/health", timeoutMs = 2500); true }.getOrDefault(false)

    suspend fun home(): HomeScreen = get("/api/home")
    suspend fun browse(kind: String): List<Rail> = get<Map<String, List<Rail>>>("/api/browse/$kind")["rails"].orEmpty()
    suspend fun details(id: String): TitleDetails = get("/api/titles/${enc(id)}")
    suspend fun season(id: String, n: Int): Season = get("/api/titles/${enc(id)}/season/$n")
    suspend fun streams(id: String, episodeId: String?): List<StreamCandidate> =
        get<Map<String, List<StreamCandidate>>>("/api/titles/${enc(id)}/streams" + (episodeId?.let { "?episode=${enc(it)}" } ?: ""), 90_000)["streams"].orEmpty()
    suspend fun search(q: String): List<SearchResult> = get<Map<String, List<SearchResult>>>("/api/search?q=${enc(q)}")["results"].orEmpty()
    suspend fun guides(): GuideChoices = get("/api/guides")
    suspend fun nowNext(category: String): List<NowNext> = get<Map<String, List<NowNext>>>("/api/nownext" + (if (category.isNotEmpty()) "?category=${enc(category)}" else ""))["items"].orEmpty()
    suspend fun programmes(channelId: String, from: Long, limit: Int): List<Programme> =
        get<Map<String, List<Programme>>>("/api/channels/${enc(channelId)}/programmes?from=$from&limit=$limit")["programmes"].orEmpty()
    suspend fun programme(id: String): ProgrammeInfo = get("/api/programmes/${enc(id)}")
    suspend fun recordings(): List<Recording> = get<Map<String, List<Recording>>>("/api/recordings")["recordings"].orEmpty()
    suspend fun record(programmeId: String) = raw("/api/recordings", "POST", mapOf("programmeId" to programmeId))
    suspend fun seriesLink(programmeId: String) = raw("/api/series-links", "POST", mapOf("programmeId" to programmeId))
    suspend fun deleteRecording(id: String) = raw("/api/recordings/${enc(id)}", "DELETE")
    suspend fun markWatched(id: String, watched: Boolean) = raw("/api/recordings/${enc(id)}/watched", "POST", mapOf("watched" to watched))
    suspend fun profiles(): Profiles = get("/api/profiles")
    suspend fun unlock(id: String, pin: String?): String = post<Map<String, Any?>>("/api/profiles/${enc(id)}/unlock", mapOf("pin" to pin))["token"] as String

    /** Resolves something to play. `force` takes the IPTV connection from whoever has it. */
    suspend fun play(req: PlaybackRequest, force: Boolean = false): PlaybackInfo = post("/api/play", playBody(req, force))
    /** The same for a download: never live TV, and Jellyfin can send a smaller copy. */
    suspend fun offline(req: PlaybackRequest, smaller: Boolean): PlaybackInfo = post("/api/offline", playBody(req, false) + ("smaller" to smaller), timeoutMs = 120_000)
    suspend fun playOnTv(req: PlaybackRequest, title: TitleRef?) = raw("/api/tv/call/play", "POST", mapOf("req" to req, "title" to title))

    suspend fun progress(key: String, positionMs: Long, durationMs: Long?, event: String, paused: Boolean, title: TitleRef?) {
        val body = mutableMapOf<String, Any>("key" to key, "positionMs" to positionMs, "event" to event, "paused" to paused)
        if (durationMs != null && durationMs > 0) body["durationMs"] = durationMs
        if (title != null) body["title"] = title
        raw("/api/progress", "POST", body, 8000)
    }

    suspend fun appName(): String? = (get<Map<String, Any?>>("/api/settings", 5000)["appName"] as? String)?.takeIf { it.isNotBlank() }

    suspend fun clientVersion(): AppVersion = get("/setup/client-app.json", 5000)

    /** Saves a small file (artwork, subtitles) for offline use. */
    suspend fun fetchTo(url: String, file: File): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val c = URL(abs(url)).openConnection() as HttpURLConnection
            c.connectTimeout = 6000
            c.readTimeout = 20_000
            try {
                if (c.responseCode >= 400) return@runCatching false
                file.parentFile?.mkdirs()
                c.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
                true
            } finally {
                c.disconnect()
            }
        }.getOrDefault(false)
    }

    private fun playBody(req: PlaybackRequest, force: Boolean): Map<String, Any> {
        val m = mutableMapOf<String, Any>("kind" to req.kind, "id" to req.id)
        req.episodeId?.let { m["episodeId"] = it }
        req.start?.let { m["start"] = it }
        req.streamId?.let { m["streamId"] = it }
        if (force) m["force"] = true
        return m
    }

    companion object {
        fun enc(s: String): String = Uri.encode(s)
    }
}

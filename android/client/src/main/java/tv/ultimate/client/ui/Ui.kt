// What screens ask the app to do: play something (asking first if that takes the IPTV
// connection from the TV), download it, or play it on the TV instead.

package tv.ultimate.client.ui

import android.content.Context
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import tv.ultimate.client.ApiError
import tv.ultimate.client.App
import tv.ultimate.client.FeatureState
import tv.ultimate.client.Offline
import tv.ultimate.client.OfflineMeta
import tv.ultimate.client.PlaybackInfo
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.PlayerActivity
import tv.ultimate.client.TitleRef

data class Ask(val title: String, val message: String, val yes: String, val no: String, val answer: CompletableDeferred<Boolean>)

class Ui(private val context: Context, val scope: CoroutineScope, val snackbar: SnackbarHostState, private val askNotifications: () -> Unit) {
    private val hub get() = App.instance.hub

    /** At home and the Hub answers. Away, only Downloads works. */
    var online by mutableStateOf(true)
    /** A short "Starting…" card while the Hub looks something up. */
    var working by mutableStateOf<String?>(null)
    var ask by mutableStateOf<Ask?>(null)
    /** What the household calls the app (GazosTV, …), from the Hub's settings. */
    var appName by mutableStateOf(App.instance.prefs.appName)
    /** Features switched off on this phone (Hub: /api/features), remembered for away from home. */
    var featuresOff by mutableStateOf(App.instance.prefs.featuresOff)
    var features by mutableStateOf<FeatureState?>(null)

    fun on(feature: String): Boolean = feature !in featuresOff

    /** Films and TV shows go with their switches. */
    fun titleShown(kind: String?): Boolean = when (kind) {
        "series" -> on("shows")
        "movie" -> on("films")
        else -> true
    }

    fun featureLabel(id: String): String = features?.features?.find { it.id == id }?.label ?: when (id) {
        "live" -> "Live TV and guide"
        "films" -> "Films"
        "shows" -> "TV shows"
        "recordings" -> "Recordings"
        "downloads" -> "Downloads"
        "search" -> "Search"
        else -> id
    }

    suspend fun loadFeatures() {
        val s = runCatching { hub.features() }.getOrNull() ?: return
        features = s
        apply(s.off.orEmpty().toSet())
    }

    fun apply(off: Set<String>) {
        featuresOff = off
        App.instance.prefs.featuresOff = off
    }

    /** The feature that stops this playing here, if it's switched off. */
    private fun blockedBy(req: PlaybackRequest, title: TitleRef?): String? {
        val f = when (req.kind) {
            "channel", "catchup" -> if (req.id.startsWith("mix:")) "mix" else "live"
            "recording" -> "recordings"
            "title" -> when (title?.kind) { "series" -> "shows"; "movie" -> "films"; else -> null }
            else -> null
        }
        return f?.takeIf { !on(it) }
    }

    suspend fun confirm(title: String, message: String, yes: String, no: String = "Cancel"): Boolean {
        val answer = CompletableDeferred<Boolean>()
        ask = Ask(title, message, yes, no, answer)
        return answer.await().also { ask = null }
    }

    fun say(message: String) {
        scope.launch { snackbar.showSnackbar(message) }
    }

    fun play(req: PlaybackRequest, title: TitleRef? = null, name: String? = null) {
        blockedBy(req, title)?.let { say("${featureLabel(it)} is switched off on this phone"); return }
        scope.launch {
            working = if (req.kind == "channel") "Tuning…" else "Starting ${name ?: title?.name ?: ""}…".replace("  ", " ")
            try {
                val info = resolve(req) ?: return@launch
                PlayerActivity.play(context, info, req, title)
            } catch (e: Throwable) {
                say(explain(e))
            } finally {
                working = null
            }
        }
    }

    private suspend fun resolve(req: PlaybackRequest): PlaybackInfo? = try {
        hub.play(req)
    } catch (e: ApiError) {
        if (e.code != "busy") throw e
        working = null
        val go = confirm("Your IPTV connection is in use", e.message ?: "Something else is using it.", "Watch here", "Leave it")
        if (!go) null else hub.play(req, force = true)
    }

    fun playOnTv(req: PlaybackRequest, title: TitleRef?) {
        scope.launch {
            runCatching { hub.playOnTv(req, title) }
                .onSuccess { say("Playing on the TV") }
                .onFailure { say(explain(it)) }
        }
    }

    /** Asks the Hub for a copy to download and hands it to the download service. */
    fun download(req: PlaybackRequest, meta: OfflineMeta, smaller: Boolean) {
        if (!on("downloads")) return say("Downloads are switched off on this phone")
        scope.launch {
            working = "Getting ${meta.title ?: "it"} ready to download…"
            try {
                askNotifications()
                val info = hub.offline(req, smaller)
                Offline.add(hub, info, meta)
                say(if (App.instance.prefs.wifiOnly) "Downloading over Wi-Fi: ${meta.title ?: info.title}" else "Downloading ${meta.title ?: info.title}")
            } catch (e: Throwable) {
                say(explain(e))
            } finally {
                working = null
            }
        }
    }

    /**
     * Save to NAS: the Hub downloads this version into the Films or TV folder and adds it to
     * Jellyfin, for everyone, for good. Not the same as [download], which copies it onto this phone.
     */
    fun saveToNas(titleId: String, episodeId: String?, streamId: String?, name: String) {
        scope.launch {
            working = "Asking the Hub to save $name…"
            try {
                val d = hub.saveToNas(titleId, episodeId, streamId)
                say(if (d["status"] == "completed") "$name is already saved on the NAS" else "Saving $name to the NAS. It goes into Jellyfin when it's done.")
            } catch (e: Throwable) {
                say(explain(e))
            } finally {
                working = null
            }
        }
    }

    /** A whole season, one episode after another, with the default version of each. */
    fun downloadAll(items: List<Pair<PlaybackRequest, OfflineMeta>>, smaller: Boolean) {
        if (!on("downloads")) return say("Downloads are switched off on this phone")
        scope.launch {
            askNotifications()
            var added = 0
            var failed: Throwable? = null
            for ((i, pair) in items.withIndex()) {
                working = "Getting episode ${i + 1} of ${items.size} ready…"
                try {
                    Offline.add(hub, hub.offline(pair.first, smaller), pair.second)
                    added++
                } catch (e: Throwable) {
                    failed = e
                }
            }
            working = null
            say(if (failed == null) "Downloading $added episodes" else "Downloading $added of ${items.size}: ${explain(failed)}")
        }
    }
}

val LocalUi = staticCompositionLocalOf<Ui> { error("No Ui") }

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
import tv.ultimate.client.Favourites
import tv.ultimate.client.Offline
import tv.ultimate.client.OfflineMeta
import tv.ultimate.client.PlaybackInfo
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.PlayerActivity
import tv.ultimate.client.TitleDetails
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

    suspend fun confirm(title: String, message: String, yes: String, no: String = "Cancel"): Boolean {
        val answer = CompletableDeferred<Boolean>()
        ask = Ask(title, message, yes, no, answer)
        return answer.await().also { ask = null }
    }

    fun say(message: String) {
        scope.launch { snackbar.showSnackbar(message) }
    }

    fun play(req: PlaybackRequest, title: TitleRef? = null, name: String? = null) {
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

    /** Stars or unstars a film or show for this profile. */
    fun favouriteTitle(d: TitleDetails, on: Boolean) {
        scope.launch {
            runCatching { Favourites.setTitle(d, on) }
                .onSuccess { say(if (on) "${d.name} added to Favourites" else "${d.name} taken out of Favourites") }
                .onFailure { say(explain(it)) }
        }
    }

    /** Stars or unstars a guide channel for this profile; [after] runs once the Hub has it. */
    fun favouriteChannel(id: String, name: String, on: Boolean, after: () -> Unit = {}) {
        scope.launch {
            runCatching { Favourites.setChannel(id, on) }
                .onSuccess { say(if (on) "$name added to Favourites" else "$name taken out of Favourites"); after() }
                .onFailure { say(explain(it)) }
        }
    }

    /** Asks the Hub for a copy to download and hands it to the download service. */
    fun download(req: PlaybackRequest, meta: OfflineMeta, smaller: Boolean) {
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

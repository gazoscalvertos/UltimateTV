// Saved for later and the play queue, as this phone last saw them. Both lists live on the Hub —
// one for the household, so the TV and the phone agree — and are kept here only so a screen can
// draw straight away and so switching profile refreshes both.

package tv.ultimate.client

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

object SavedForLater {
    private val _items = MutableStateFlow<List<WatchItem>>(emptyList())
    val items: StateFlow<List<WatchItem>> = _items

    /** Fetches the list again (opening the screen, or after switching profile). Quiet when the Hub is away. */
    suspend fun load() {
        runCatching { App.instance.hub.watchlist() }.onSuccess { _items.value = it.items.orEmpty() }
    }

    /** Saves a film or show, or takes it off again; both answers carry the list as it now stands. */
    suspend fun set(t: TitleRef, on: Boolean): List<WatchItem> {
        val r = if (on) App.instance.hub.saveForLater(t) else App.instance.hub.unsave(t.id)
        return r.items.orEmpty().also { _items.value = it }
    }

    /** Takes a row off the list by its own id, which works even when the Hub never found the title. */
    suspend fun remove(id: String): List<WatchItem> =
        App.instance.hub.unsave(id).items.orEmpty().also { _items.value = it }

    fun has(titleId: String): Boolean = _items.value.any { it.title?.id == titleId || it.id == titleId }
}

object PlayQueue {
    private val _items = MutableStateFlow<List<QueueItem>>(emptyList())
    val items: StateFlow<List<QueueItem>> = _items

    suspend fun load() {
        runCatching { App.instance.hub.queue() }.onSuccess { _items.value = it.queue.orEmpty() }
    }

    /** Adds a film or episode to the end; the answer says which row it made and where it landed. */
    suspend fun add(req: PlaybackRequest, title: TitleRef?, name: String, subtitle: String?, image: String?): QueueChange {
        val r = App.instance.hub.addToQueue(req, title, name, subtitle, image)
        r.queue?.let { _items.value = it }
        return r
    }

    suspend fun move(id: String, to: Int) {
        App.instance.hub.moveInQueue(id, to).queue?.let { _items.value = it }
    }

    suspend fun remove(id: String) {
        App.instance.hub.unqueue(id).queue?.let { _items.value = it }
    }

    suspend fun clear() {
        App.instance.hub.clearQueue().queue?.let { _items.value = it }
    }
}

/** The copies the Hub is keeping on the NAS, for the Save to NAS list on a title's page. */
object NasSaves {
    private val _items = MutableStateFlow<List<Download>>(emptyList())
    val items: StateFlow<List<Download>> = _items

    suspend fun load() {
        runCatching { App.instance.hub.downloads() }.onSuccess { _items.value = it }
    }

    /** What a save says on screen: "42%", "Finishing off", "Saved". */
    fun status(d: Download): String = when (d.status) {
        "queued" -> "Waiting to start"
        "waiting-debrid" -> "Waiting for TorBox"
        "downloading" -> d.progress?.let { "${(it * 100).toInt()}%" } ?: "Saving"
        "moving" -> "Finishing off"
        "completed" -> when {
            d.jellyfin?.added == true -> "Saved, and in Jellyfin"
            d.jellyfin?.note?.isNotBlank() == true -> "Saved. ${d.jellyfin.note}"
            else -> "Saved on the NAS"
        }
        "failed" -> d.error?.takeIf { it.isNotBlank() }?.let { "Didn't save: $it" } ?: "Didn't save"
        "cancelled" -> "Cancelled"
        else -> d.status
    }

    /** The saves for one film or show: the Hub files a save under the title's name and kind. */
    fun forTitle(name: String, kind: String): List<Download> =
        _items.value.filter { it.title == name && it.kind == kind }

    /** The save for one episode of a show, if the Hub is already keeping it. */
    fun forEpisode(name: String, kind: String, season: Int, episode: Int): Download? =
        forTitle(name, kind).firstOrNull { it.season == season && it.episode == episode }
}

// The Hub's JSON, as far as the app uses it (shared/src/domain.ts is the full model).
// Gson fills these without calling constructors, so anything the Hub may leave out is nullable.

package tv.ultimate.client

import com.google.gson.annotations.SerializedName

data class Channel(
    val id: String,
    val number: Int,
    val name: String,
    val logo: String?,
    val category: String?,
    val catchupDays: Int?,
    val maxHeight: Int?,
    val mix: Any?,
)

data class Programme(
    val id: String,
    val channelId: String,
    val start: Long,
    val end: Long,
    val title: String,
    val subtitle: String?,
    val description: String?,
    val season: Int?,
    val episode: Int?,
    val image: String?,
    val isNew: Boolean?,
    val isFilm: Boolean?,
    val year: Int?,
    val rating: String?,
)

data class NowNext(val channel: Channel, val now: Programme?, val next: Programme?)

data class GuideChoice(val id: String, val label: String, val kind: String, val count: Int)
data class GuideChoices(val choices: List<GuideChoice>?, val default: String?)

data class StreamQuality(
    val height: Int?,
    val hdr: String?,
    val codec: String?,
    val audio: String?,
    val channels: Int?,
    val sizeBytes: Long?,
)

data class StreamCandidate(
    val id: String,
    val kind: String,
    val label: String,
    val detail: String?,
    val quality: StreamQuality?,
    val ready: Boolean?,
    val badges: List<String>?,
    val lang: String?,
    /** The Hub can keep this copy on the NAS for Jellyfin (Save to NAS). */
    val downloadable: Boolean? = null,
)

data class TitleRef(
    val id: String,
    val kind: String,
    val name: String,
    val year: Int?,
    val poster: String?,
    val backdrop: String?,
    val logo: String?,
    val progress: Double?,
    val badges: List<String>?,
    val subtitle: String?,
)

data class Episode(
    val id: String,
    val season: Int,
    val episode: Int,
    val name: String,
    val overview: String?,
    val still: String?,
    val runtimeMin: Int?,
    val progress: Double?,
    val watched: Boolean?,
)

/** One profile's favourites (GET /api/favourites): films and shows, and guide channel ids. */
data class FavouriteTitle(val title: TitleRef, val addedAt: Long?)
data class FavouriteState(val titles: List<FavouriteTitle>?, val channels: List<String>?) {
    fun hasTitle(id: String) = titles.orEmpty().any { it.title.id == id }
    fun hasChannel(id: String) = channels.orEmpty().contains(id)
}

data class Season(val season: Int, val name: String, val episodes: List<Episode>?)

/**
 * The next time a saved title turns up on the household's channels (shared/src/household.ts).
 * `when` already reads "On Film4 · Sat 21:00", so the app never formats a date itself.
 */
data class NextAiring(
    val programmeId: String,
    val channelId: String,
    val channelName: String,
    val channelNumber: Int,
    val start: Long,
    val end: Long,
    // `when` is a Kotlin keyword; the Hub's name for it is kept exactly so the JSON matches.
    @SerializedName("when") val whenText: String?,
)

/** Something on the household's Saved for later list (shared/src/household.ts), shared with the TV. */
data class WatchItem(
    val id: String,
    val name: String,
    val year: Int?,
    val kind: String,
    val title: TitleRef?,
    val addedAt: Long?,
    val from: String?,
    val next: NextAiring?,
)

data class WatchlistState(val items: List<WatchItem>?) {
    fun has(titleId: String) = items.orEmpty().any { it.title?.id == titleId || it.id == titleId }
}

/** What saving or removing gave back: the list as it now stands, and the row that changed. */
data class WatchlistChange(val item: WatchItem?, val items: List<WatchItem>?)

/** Something lined up to play next on the household's queue (shared/src/domain.ts). */
data class QueueItem(
    val id: String,
    val req: PlaybackRequest,
    val title: TitleRef?,
    val name: String,
    val subtitle: String?,
    val image: String?,
    val addedAt: Long?,
)

data class QueueState(val queue: List<QueueItem>?)

/** Adding to the queue answers with the row it made, so the app can say where it landed. */
data class QueueChange(val item: QueueItem?, val queue: List<QueueItem>?)

/** A copy the Hub is keeping on the NAS for Jellyfin (shared/src/domain.ts Download). */
data class Download(
    val id: String,
    val title: String,
    val kind: String,
    val year: Int?,
    val season: Int?,
    val episode: Int?,
    val status: String,
    val progress: Double?,
    val bytesDone: Long?,
    val bytesTotal: Long?,
    val speedBps: Long?,
    val path: String?,
    val error: String?,
    val jellyfin: JellyfinResult?,
    val createdAt: Long?,
)

data class JellyfinResult(val added: Boolean?, val note: String?)

data class DownloadsState(val downloads: List<Download>?)

data class TitleDetails(
    val id: String,
    val kind: String,
    val name: String,
    val year: Int?,
    val poster: String?,
    val backdrop: String?,
    val logo: String?,
    val overview: String?,
    val genres: List<String>?,
    val runtimeMin: Int?,
    val rating: Double?,
    val certification: String?,
    val cast: List<String>?,
    val seasons: List<Season>?,
    val resumeMs: Long?,
    val availability: List<String>?,
) {
    fun ref() = TitleRef(id, kind, name, year, poster, backdrop, logo, null, null, null)
}

data class Recording(
    val id: String,
    val programme: Programme,
    val channelId: String,
    val channelName: String,
    val status: String,
    val start: Long,
    val end: Long,
    val sizeBytes: Long?,
    val watched: Boolean?,
    val positionMs: Long?,
    val incomplete: Boolean?,
    val error: String?,
)

data class Rail(
    val id: String,
    val title: String,
    val kind: String,
    val items: List<TitleRef>?,
    val channels: List<NowNext>?,
    val recordings: List<Recording>?,
)

data class Hero(
    val id: String,
    val kind: String,
    val name: String,
    val year: Int?,
    val poster: String?,
    val backdrop: String?,
    val overview: String?,
    val action: String?,
    val subtitle: String?,
) {
    fun ref() = TitleRef(id, kind, name, year, poster, backdrop, null, null, null, subtitle)
}

data class HomeScreen(val hero: Hero?, val rails: List<Rail>?)

data class SearchResult(
    val kind: String,
    val id: String,
    val name: String,
    val subtitle: String?,
    val image: String?,
    val title: TitleRef?,
    val channel: Channel?,
    val programme: Programme?,
    val recording: Recording?,
)

data class SubtitleTrack(val url: String, val lang: String?, val label: String?)
data class SkipMarker(val kind: String, val startMs: Long, val endMs: Long)
data class SourceLabel(val kind: String?, val label: String?)

/** What the Hub sends back for "play this": everything the player needs. */
data class PlaybackRequest(
    val kind: String,
    val id: String,
    val episodeId: String? = null,
    val start: Long? = null,
    val streamId: String? = null,
)

data class NextUp(
    val kind: String,
    val id: String,
    val episodeId: String?,
    val name: String,
    val image: String?,
    val overview: String?,
) {
    fun request() = PlaybackRequest(kind, id, episodeId)
}

data class PlaybackInfo(
    val url: String,
    val headers: Map<String, String>?,
    val title: String,
    val subtitle: String?,
    val live: Boolean,
    val startMs: Long?,
    val durationMs: Long?,
    val quality: StreamQuality?,
    val source: SourceLabel?,
    val externalSubtitles: List<SubtitleTrack>?,
    val progressKey: String,
    val skip: List<SkipMarker>?,
    val next: NextUp?,
    val artwork: String?,
    val logo: String?,
    val queue: List<String>?,
    val hls: Boolean?,
)

data class Profile(
    val id: String,
    val name: String,
    val kind: String,
    val colour: String?,
    val hasPin: Boolean?,
)

data class Profiles(val profiles: List<Profile>?, val locked: Boolean?, val current: String?, val admin: Boolean?)

data class ProgrammeInfo(
    val programme: Programme,
    val channel: Channel?,
    val recording: Recording?,
    val seriesLink: Any?,
    val catchup: Boolean?,
    val reminder: Boolean?,
)

/**
 * The build the Hub has (#93). `uninstallBelow` is the first versionCode signed with the key the Hub
 * uses now: an app older than that was signed with the key that used to be in the repo, so Android
 * refuses to install the new one over it and the old app has to go first.
 */
data class AppVersion(val versionCode: Int, val versionName: String?, val uninstallBelow: Int? = null)

/** What's new: the Hub's CHANGELOG.md (GET /api/changelog). */
data class ChangeEntry(val id: String, val title: String, val text: String?, val prs: List<Int>?)
data class ChangeRelease(val id: String, val date: String?, val version: String?, val note: String?, val entries: List<ChangeEntry>?)
data class Changelog(val releases: List<ChangeRelease>?, val latest: String?, val unseen: List<ChangeEntry>?)

/** A part of the app that can be switched off on one phone or screen (Hub: shared/src/features.ts). */
data class FeatureInfo(val id: String, val label: String, val detail: String, val clients: List<String>?)

/** GET /api/features: this phone's paired id and what's switched off on it. */
data class FeatureState(val device: String?, val client: String?, val off: List<String>?, val features: List<FeatureInfo>?)

// Watching elsewhere and Sync play (Hub: shared/src/watching.ts).

data class WatchProfile(val id: String, val name: String?)

/** Another screen's playback: what, where it has got to (at `at`, Hub clock) and whether it stopped. */
data class WatchSession(
    val device: String,
    val deviceName: String?,
    val client: String?,
    val box: String?,
    val req: PlaybackRequest,
    val name: String,
    val subtitle: String?,
    val artwork: String?,
    val title: TitleRef?,
    val live: Boolean,
    val positionMs: Long,
    val durationMs: Long?,
    val paused: Boolean,
    val at: Long,
    val stopped: Boolean,
    val profile: WatchProfile?,
    val sync: String?,
)

data class WatchingState(val now: Long?, val me: String?, val sessions: List<WatchSession>?)

data class SyncMember(val device: String, val deviceName: String?, val client: String?)
data class SyncLast(val device: String?, val deviceName: String?, val action: String?)

/** A Sync play group's shared clock: where everyone should be at `at` (Hub clock), and paused or not. */
data class SyncGroup(
    val id: String,
    val req: PlaybackRequest,
    val name: String,
    val subtitle: String?,
    val title: TitleRef?,
    val live: Boolean,
    val durationMs: Long?,
    val positionMs: Long,
    val paused: Boolean,
    val at: Long,
    val seq: Int,
    val members: List<SyncMember>?,
    val ended: Boolean,
    val last: SyncLast?,
)

data class SyncReply(val now: Long?, val group: SyncGroup?)
data class WatchCommand(val type: String, val group: String?)
data class WatchReply(val now: Long?, val me: String?, val commands: List<WatchCommand>?, val sync: SyncGroup?)

/** Where a session or group is now, given where it was at `at` (both by the Hub's clock). */
fun placeAt(positionMs: Long, paused: Boolean, at: Long, durationMs: Long?, hubNow: Long): Long {
    val pos = positionMs + if (paused) 0L else maxOf(0L, hubNow - at)
    return if (durationMs != null && durationMs > 0) minOf(pos, durationMs) else pos
}

/** "3:05" or "1:02:09". */
fun clockLabel(ms: Long): String {
    val total = maxOf(0L, ms / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** What a profile chose for a series: a language and kind, never a track number (issue #228). */
data class TrackPrefAudio(val lang: String, val description: Boolean?)
data class TrackPref(
    val audio: TrackPrefAudio?,
    /** "off", or an object with a `lang` (Gson reads either into Any). */
    val subtitle: Any?,
) {
    val subtitleOff get() = subtitle == "off"
    val subtitleLang get() = (subtitle as? Map<*, *>)?.get("lang") as? String
}

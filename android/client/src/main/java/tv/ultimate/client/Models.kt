// The Hub's JSON, as far as the app uses it (shared/src/domain.ts is the full model).
// Gson fills these without calling constructors, so anything the Hub may leave out is nullable.

package tv.ultimate.client

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

data class AppVersion(val versionCode: Int, val versionName: String?)

/** What's new: the Hub's CHANGELOG.md (GET /api/changelog). */
data class ChangeEntry(val id: String, val title: String, val text: String?, val prs: List<Int>?)
data class ChangeRelease(val id: String, val date: String?, val version: String?, val note: String?, val entries: List<ChangeEntry>?)
data class Changelog(val releases: List<ChangeRelease>?, val latest: String?, val unseen: List<ChangeEntry>?)

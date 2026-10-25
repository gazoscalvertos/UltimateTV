// Films and TV: the browse rails, a title's page (seasons, episodes, versions) and the sheet for
// choosing which version to play or download.

package tv.ultimate.client.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import tv.ultimate.client.App
import tv.ultimate.client.Episode
import tv.ultimate.client.Offline
import tv.ultimate.client.OfflineEntry
import tv.ultimate.client.OfflineMeta
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.StreamCandidate
import tv.ultimate.client.TitleDetails

@Composable
fun LibraryScreen(nav: NavHostController) {
    val ui = LocalUi.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val kind = if (tab == 0) "movie" else "series"
    val rails = rememberLoad(kind, ui.online) { App.instance.hub.browse(kind) }
    Column {
        Header("Films & TV", nav)
        TabRow(selectedTabIndex = tab, containerColor = MaterialTheme.colorScheme.background) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Films") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("TV shows") })
        }
        Loaded(rails) { list ->
            if (list.isEmpty()) Empty("Nothing here yet. Add Jellyfin or an addon on the Hub's setup page.")
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                items(list, key = { it.id }) { r -> PosterRail(r.title, r.items.orEmpty()) { details(nav, it.id) } }
            }
        }
    }
}

/** A download that belongs to this title (and episode), for the tick on its button. */
@Composable
private fun downloaded(titleId: String, episodeId: String?): OfflineEntry? {
    val entries by Offline.entries.collectAsState()
    return entries.find { it.item.titleId == titleId && it.item.episodeId == episodeId }
}

/** Opens the version sheet for playing or downloading. */
private data class Choose(val download: Boolean, val episode: Episode?)

@Composable
fun DetailsScreen(nav: NavHostController, id: String) {
    val hub = App.instance.hub
    val ui = LocalUi.current
    val details = rememberLoad(id) { hub.details(id) }
    var choose by remember { mutableStateOf<Choose?>(null) }
    Column {
        Header("", nav, back = true)
        Loaded(details) { d ->
            val wide = isWide()
            var season by rememberSaveable(d.id) { mutableIntStateOf(firstSeason(d)) }
            val seasonLoad = rememberLoad(d.id, season) {
                val listed = d.seasons?.find { it.season == season }
                if (listed != null && !listed.episodes.isNullOrEmpty()) listed else hub.season(d.id, season)
            }
            LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
                item {
                    Box(Modifier.fillMaxWidth().aspectRatio(if (wide) 2.6f else 16f / 9f)) {
                        Picture(d.backdrop ?: d.poster, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xFF070B14)))))
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(d.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        val facts = listOfNotNull(d.year?.toString(), d.certification, d.runtimeMin?.let { minutes(it * 60_000L) }, d.rating?.let { String.format(java.util.Locale.UK, "★ %.1f", it) }, d.genres?.take(3)?.joinToString(", "))
                        Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val resume = (d.resumeMs ?: 0) > 0
                            if (d.kind == "movie") {
                                Button(onClick = { ui.play(PlaybackRequest("title", d.id), d.ref()) }) {
                                    Icon(Icons.Default.PlayArrow, null)
                                    Text(if (resume) "Resume" else "Play")
                                }
                                DownloadButton(downloaded(d.id, null)) { choose = Choose(true, null) }
                            } else {
                                val next = nextEpisode(seasonLoad.state)
                                if (next != null) Button(onClick = { ui.play(PlaybackRequest("title", d.id, "s${next.season}e${next.episode}"), d.ref()) }) {
                                    Icon(Icons.Default.PlayArrow, null)
                                    Text("S${next.season} E${next.episode}")
                                }
                            }
                            IconButton(onClick = { ui.playOnTv(PlaybackRequest("title", d.id), d.ref()) }) { Icon(Icons.Default.Tv, "Play on the TV") }
                        }
                        if (d.kind == "movie") {
                            Text("Other versions", Modifier.clickable { choose = Choose(false, null) }.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.primary)
                        }
                        d.overview?.let { Text(it, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyMedium) }
                        if (!d.cast.isNullOrEmpty()) Text("With ${d.cast.take(5).joinToString(", ")}", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (d.kind == "series") {
                    item {
                        LazyRow(Modifier.padding(top = 16.dp), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(d.seasons.orEmpty(), key = { it.season }) { s -> FilterChip(selected = s.season == season, onClick = { season = s.season }, label = { Text(s.name) }) }
                        }
                    }
                    when (val st = seasonLoad.state) {
                        is Load.Loading -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                        is Load.Err -> item { Text(explain(st.error), Modifier.padding(16.dp)) }
                        is Load.Ok -> {
                            val episodes = st.value.episodes.orEmpty()
                            if (episodes.isNotEmpty()) item {
                                Text(
                                    "Download all ${episodes.size} episodes",
                                    Modifier.clickable {
                                        ui.downloadAll(episodes.map { e -> PlaybackRequest("title", d.id, "s${e.season}e${e.episode}") to episodeMeta(d, e) }, App.instance.prefs.smaller)
                                    }.padding(16.dp),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            items(episodes, key = { "${it.season}-${it.episode}" }) { e ->
                                EpisodeRow(
                                    e,
                                    downloaded(d.id, "s${e.season}e${e.episode}"),
                                    play = { ui.play(PlaybackRequest("title", d.id, "s${e.season}e${e.episode}"), d.ref()) },
                                    download = { choose = Choose(true, e) },
                                    versions = { choose = Choose(false, e) },
                                )
                            }
                        }
                    }
                }
            }
            choose?.let { c -> VersionSheet(d, c.episode, c.download) { choose = null } }
        }
    }
}

private fun firstSeason(d: TitleDetails): Int {
    val seasons = d.seasons.orEmpty()
    // Carry on where you were: the first season with an unwatched episode (specials last).
    return seasons.filter { it.season > 0 }.firstOrNull { s -> s.episodes.orEmpty().any { it.watched != true } }?.season ?: seasons.firstOrNull { it.season > 0 }?.season ?: seasons.firstOrNull()?.season ?: 1
}

private fun nextEpisode(state: Load<tv.ultimate.client.Season>): Episode? {
    val eps = (state as? Load.Ok)?.value?.episodes.orEmpty()
    return eps.firstOrNull { (it.progress ?: 0.0) in 0.01..0.9 } ?: eps.firstOrNull { it.watched != true } ?: eps.firstOrNull()
}

fun episodeMeta(d: TitleDetails, e: Episode) = OfflineMeta(
    kind = "episode",
    title = e.name,
    subtitle = "${d.name} · S${e.season} E${e.episode}",
    titleId = d.id,
    episodeId = "s${e.season}e${e.episode}",
    showName = d.name,
    season = e.season,
    episode = e.episode,
    artwork = e.still ?: d.backdrop ?: d.poster,
    ref = d.ref(),
)

fun movieMeta(d: TitleDetails) = OfflineMeta(kind = "movie", title = d.name, subtitle = d.year?.toString(), titleId = d.id, artwork = d.backdrop ?: d.poster, ref = d.ref())

@Composable
private fun DownloadButton(entry: OfflineEntry?, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = entry == null) {
        when {
            entry == null -> {
                Icon(Icons.Default.Download, null)
                Spacer(Modifier.width(6.dp))
                Text("Download")
            }
            entry.done -> {
                Icon(Icons.Default.DownloadDone, null)
                Spacer(Modifier.width(6.dp))
                Text("Downloaded")
            }
            else -> Text("Downloading ${entry.percent.toInt()}%")
        }
    }
}

@Composable
private fun EpisodeRow(e: Episode, entry: OfflineEntry?, play: () -> Unit, download: () -> Unit, versions: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = play).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            Picture(e.still, Modifier.width(if (isWide()) 200.dp else 136.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)))
            val p = e.progress ?: 0.0
            if (p > 0.01 && e.watched != true) LinearProgressIndicator(progress = { p.toFloat() }, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(4.dp).height(3.dp))
            if (e.watched == true) Icon(Icons.Default.CheckCircle, "Watched", Modifier.align(Alignment.TopEnd).padding(4.dp).size(18.dp), tint = Color.White)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("${e.episode}. ${e.name}", maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            e.runtimeMin?.let { Text(minutes(it * 60_000L), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            e.overview?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text("Versions", Modifier.clickable(onClick = versions).padding(top = 4.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        when {
            entry == null -> IconButton(onClick = download) { Icon(Icons.Default.Download, "Download") }
            entry.done -> Icon(Icons.Default.DownloadDone, "Downloaded", Modifier.padding(12.dp), tint = MaterialTheme.colorScheme.primary)
            else -> Box(Modifier.padding(12.dp)) { CircularProgressIndicator(progress = { entry.percent / 100f }, modifier = Modifier.size(24.dp), strokeWidth = 2.dp) }
        }
    }
}

/** Every copy the sources have (4K remux, 1080p, IPTV…), to play one or download it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VersionSheet(d: TitleDetails, e: Episode?, download: Boolean, close: () -> Unit) {
    val hub = App.instance.hub
    val ui = LocalUi.current
    val episodeId = e?.let { "s${it.season}e${it.episode}" }
    val streams = rememberLoad(d.id, episodeId) { hub.streams(d.id, episodeId) }
    var picked by remember { mutableStateOf<String?>(null) }
    var smaller by remember { mutableStateOf(App.instance.prefs.smaller) }
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).heightIn(min = 200.dp)) {
            Text(if (download) "Download ${e?.name ?: d.name}" else "Choose a version", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            when (val st = streams.state) {
                is Load.Loading -> Row(Modifier.padding(vertical = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Asking every source…")
                }
                is Load.Err -> Text(explain(st.error), Modifier.padding(vertical = 16.dp))
                is Load.Ok -> {
                    val list = st.value
                    if (list.isEmpty()) Text("Nothing to play this from yet.", Modifier.padding(vertical = 16.dp))
                    val chosen = list.find { it.id == picked } ?: list.firstOrNull { it.ready == true } ?: list.firstOrNull()
                    LazyColumn(Modifier.heightIn(max = 380.dp)) {
                        items(list, key = { it.id }) { s -> VersionRow(s, s.id == chosen?.id) { picked = s.id } }
                    }
                    if (download && chosen != null) {
                        if (chosen.kind == "jellyfin") {
                            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Smaller copy")
                                    Text("720p, about 1.4 GB an hour. Jellyfin makes it as it downloads.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Switch(checked = smaller, onCheckedChange = { smaller = it })
                            }
                        }
                        if (chosen.kind == "xtream") {
                            Text("IPTV downloads use your IPTV connection, so they wait while anyone is watching TV.", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Button(
                        enabled = chosen != null,
                        onClick = {
                            val c = chosen ?: return@Button
                            close()
                            val req = PlaybackRequest("title", d.id, episodeId, streamId = c.id)
                            if (download) ui.download(req, if (e != null) episodeMeta(d, e) else movieMeta(d), smaller && c.kind == "jellyfin")
                            else ui.play(req, d.ref())
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (download) "Download" else "Play") }
                }
            }
        }
    }
}

@Composable
private fun VersionRow(s: StreamCandidate, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().selectable(selected = selected, onClick = onClick).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onClick)
        Column(Modifier.weight(1f)) {
            Text(listOfNotNull(s.label, s.badges?.joinToString(" "), size(s.quality?.sizeBytes)).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis)
            s.detail?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (s.ready == false) Text("Not cached", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

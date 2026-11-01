// Home, the TV guide and a channel's schedule (with the programme sheet: watch, catch up, record).

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.ultimate.client.App
import tv.ultimate.client.NowNext
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.Programme

/** The title bar; on phones it carries Search and Settings (tablets have them in the side rail). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Header(title: String, nav: NavHostController, back: Boolean = false) {
    val wide = isWide()
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { if (back) IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = {
            if (!wide) {
                if (LocalUi.current.on("search")) IconButton(onClick = { go(nav, "search") }) { Icon(Icons.Default.Search, "Search") }
                IconButton(onClick = { go(nav, "settings") }) { Icon(Icons.Default.Settings, "Settings") }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        // The Scaffold already pads for the status bar; the bar's own inset doubled it (a big empty band).
        windowInsets = WindowInsets(0, 0, 0, 0),
    )
}

@Composable
fun HomeScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val home = rememberLoad(ui.online) { hub.home() }
    Column {
        Header(ui.appName, nav)
        Loaded(home) { h ->
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                // What's switched off on this phone leaves Home too.
                h.hero?.takeIf { ui.titleShown(it.kind) && (it.action != "live" || ui.on("live")) }?.let { hero ->
                    item {
                        Box(Modifier.fillMaxWidth().aspectRatio(if (isWide()) 2.4f else 16f / 9f).clickable { details(nav, hero.id) }) {
                            Picture(hero.backdrop ?: hero.poster, Modifier.fillMaxSize())
                            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xEE070B14)))))
                            Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                                Text(hero.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                                hero.overview?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                Spacer(Modifier.height(10.dp))
                                Button(onClick = {
                                    if (hero.action == "live") ui.play(PlaybackRequest("channel", hero.id), name = hero.name)
                                    else ui.play(PlaybackRequest("title", hero.id), hero.ref())
                                }) {
                                    Icon(Icons.Default.PlayArrow, null)
                                    Text(if (hero.action == "resume") "Resume" else "Watch")
                                }
                            }
                        }
                    }
                }
                val rails = h.rails.orEmpty()
                    .filter { !(it.kind == "channels" && !ui.on("live")) && !(it.kind == "recordings" && !ui.on("recordings")) }
                    .map { r -> if (r.items != null) r.copy(items = r.items.filter { ui.titleShown(it.kind) }) else r }
                for (rail in rails) {
                    item {
                        when (rail.kind) {
                            "channels" -> if (!rail.channels.isNullOrEmpty()) {
                                SectionTitle(rail.title)
                                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    items(rail.channels) { n -> ChannelCard(n) { ui.play(PlaybackRequest("channel", n.channel.id), name = n.channel.name) } }
                                }
                            }
                            "recordings" -> if (!rail.recordings.isNullOrEmpty()) {
                                SectionTitle(rail.title)
                                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    items(rail.recordings) { r -> RecordingCard(r) { ui.play(PlaybackRequest("recording", r.id), name = r.programme.title) } }
                                }
                            }
                            else -> PosterRail(rail.title, rail.items.orEmpty()) { details(nav, it.id) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun GuideScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val choices = rememberLoad(ui.online) { hub.guides() }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    Column {
        Header("TV Guide", nav)
        Loaded(choices) { c ->
            val current = selected ?: c.default.orEmpty()
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(c.choices.orEmpty().filter { it.count > 0 }) { g ->
                    FilterChip(selected = g.id == current, onClick = { selected = g.id }, label = { Text(g.label) })
                }
            }
            val list = rememberLoad(current) { hub.nowNext(current) }
            // The guide moves on by itself: what's on now changes every half hour or so.
            LaunchedEffect(current) {
                while (true) {
                    delay(60_000)
                    list.reload()
                }
            }
            Loaded(list) { rows ->
                if (rows.isEmpty()) Empty("No channels in this list.")
                LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(rows) { n ->
                        ChannelRow(n, play = { ui.play(PlaybackRequest("channel", n.channel.id), name = n.channel.name) }, schedule = { channel(nav, n.channel.id, n.channel.name) })
                    }
                }
            }
        }
    }
}

@Composable
private fun ChannelRow(n: NowNext, play: () -> Unit, schedule: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = play).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Picture(n.channel.logo, Modifier.size(56.dp, 36.dp).clip(RoundedCornerShape(4.dp)), ContentScale.Fit)
            Text("${n.channel.number}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(n.channel.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            val now = n.now
            Text(now?.title ?: "No information", style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (now != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LinearProgressIndicator(progress = { progressOf(now.start, now.end) }, modifier = Modifier.weight(1f).height(3.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("${clock(now.start)}–${clock(now.end)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            n.next?.let { Text("Then ${clock(it.start)} ${it.title}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        IconButton(onClick = schedule) { Icon(Icons.Default.CalendarMonth, "What's on later") }
    }
}

/** A channel's schedule: earlier today (catch-up), on now and coming up. */
@Composable
fun ChannelScreen(nav: NavHostController, id: String, name: String) {
    val hub = App.instance.hub
    val ui = LocalUi.current
    val list = rememberLoad(id) { hub.programmes(id, System.currentTimeMillis() - 12 * 3_600_000L, 120) }
    var open by remember { mutableStateOf<Programme?>(null) }
    Column {
        Header(name, nav, back = true)
        Row(Modifier.padding(horizontal = 16.dp)) {
            Button(onClick = { ui.play(PlaybackRequest("channel", id), name = name) }) {
                Icon(Icons.Default.PlayArrow, null)
                Text("Watch live")
            }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { ui.playOnTv(PlaybackRequest("channel", id), null) }) {
                Icon(Icons.Default.Tv, null)
                Spacer(Modifier.width(6.dp))
                Text("On the TV")
            }
        }
        Loaded(list) { programmes ->
            if (programmes.isEmpty()) Empty("No guide information for this channel.")
            val now = System.currentTimeMillis()
            LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
                var lastDay = ""
                for (p in programmes) {
                    val d = day(p.start)
                    if (d != lastDay) {
                        lastDay = d
                        item { SectionTitle(d) }
                    }
                    item {
                        val onNow = p.start <= now && p.end > now
                        Row(Modifier.fillMaxWidth().clickable { open = p }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                            Text(clock(p.start), Modifier.width(56.dp), color = if (onNow) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                            Column(Modifier.weight(1f)) {
                                Text(p.title, fontWeight = if (onNow) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                val sub = listOfNotNull(if (onNow) "On now" else if (p.end < now) "Earlier" else null, episodeLabel(p.season, p.episode), p.subtitle).joinToString(" · ")
                                if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
    open?.let { p -> ProgrammeSheet(p.id) { open = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgrammeSheet(programmeId: String, close: () -> Unit) {
    val hub = App.instance.hub
    val ui = LocalUi.current
    val scope = rememberCoroutineScope()
    val info = rememberLoad(programmeId) { hub.programme(programmeId) }
    ModalBottomSheet(onDismissRequest = close) {
        Box(Modifier.heightIn(min = 200.dp)) {
            Loaded(info) { pi ->
                val p = pi.programme
                val now = System.currentTimeMillis()
                Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
                    p.image?.let { Picture(it, Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) }
                    Spacer(Modifier.height(12.dp))
                    Text(p.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        listOfNotNull("${day(p.start)} ${clock(p.start)}–${clock(p.end)}", pi.channel?.name, episodeLabel(p.season, p.episode), p.subtitle, p.rating).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    p.description?.let { Text(it, Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodyMedium) }
                    pi.recording?.let { r ->
                        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.FiberManualRecord, null, tint = Color(0xFFE5484D), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                when (r.status) {
                                    "completed" -> "Recorded"
                                    "recording" -> "Recording now"
                                    "failed" -> "The recording failed"
                                    else -> "Set to record"
                                } + if (pi.seriesLink != null) " · Series link" else "",
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (p.start <= now && p.end > now) {
                            Button(onClick = { close(); ui.play(PlaybackRequest("channel", p.channelId), name = pi.channel?.name) }, Modifier.fillMaxWidth()) { Text("Watch live") }
                        }
                        if (pi.catchup == true) {
                            OutlinedButton(onClick = { close(); ui.play(PlaybackRequest("catchup", p.id, start = p.start), name = p.title) }, Modifier.fillMaxWidth()) { Text("Watch from the start") }
                        }
                        pi.recording?.takeIf { it.status == "completed" }?.let { r ->
                            OutlinedButton(onClick = { close(); ui.play(PlaybackRequest("recording", r.id), name = p.title) }, Modifier.fillMaxWidth()) { Text("Play the recording") }
                        }
                        if (p.end > now && pi.recording == null) {
                            OutlinedButton(onClick = {
                                scope.launch {
                                    runCatching { hub.record(p.id) }.onSuccess { ui.say("Recording ${p.title}"); info.reload() }.onFailure { ui.say(explain(it)) }
                                }
                            }, Modifier.fillMaxWidth()) { Text("Record") }
                        }
                        if (p.end > now && pi.seriesLink == null && (p.season != null || p.episode != null || p.isFilm != true)) {
                            OutlinedButton(onClick = {
                                scope.launch {
                                    runCatching { hub.seriesLink(p.id) }.onSuccess { ui.say("Series link set for ${p.title}"); info.reload() }.onFailure { ui.say(explain(it)) }
                                }
                            }, Modifier.fillMaxWidth()) { Text("Record the series") }
                        }
                    }
                }
            }
        }
    }
}

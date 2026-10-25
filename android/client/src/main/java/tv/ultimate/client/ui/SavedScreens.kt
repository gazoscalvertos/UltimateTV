// Recordings on the Hub, and downloads on the phone (the one tab that works away from home).

package tv.ultimate.client.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import tv.ultimate.client.App
import tv.ultimate.client.Offline
import tv.ultimate.client.OfflineEntry
import tv.ultimate.client.OfflineMeta
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.PlayerActivity
import tv.ultimate.client.Recording
import java.io.File

@Composable
fun RecordingsScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val list = rememberLoad(ui.online) { hub.recordings() }
    val entries by Offline.entries.collectAsState()
    Column {
        Header("Recordings", nav)
        Loaded(list) { all ->
            val now = all.filter { it.status == "recording" }
            val done = all.filter { it.status == "completed" }.sortedByDescending { it.programme.start }
            val coming = all.filter { it.status == "scheduled" || it.status == "waiting-catchup" }.sortedBy { it.programme.start }
            val failed = all.filter { it.status == "failed" }
            if (all.isEmpty()) Empty("No recordings yet. Pick a programme in the TV Guide and choose Record.")
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                fun section(title: String, rs: List<Recording>) {
                    if (rs.isEmpty()) return
                    item(key = "h-$title") { SectionTitle(title) }
                    items(rs, key = { it.id }) { r ->
                        RecordingRow(r, entries.find { it.item.progressKey == "recording:${r.id}" }, list.reload)
                    }
                }
                section("Recording now", now)
                section("Recorded", done)
                section("Coming up", coming)
                section("Didn't record", failed)
            }
        }
    }
}

@Composable
private fun RecordingRow(r: Recording, entry: OfflineEntry?, reload: () -> Unit) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    var menu by remember { mutableStateOf(false) }
    val p = r.programme
    val playable = r.status == "completed" || r.status == "recording"
    Row(
        Modifier.fillMaxWidth().clickable(enabled = playable) { ui.play(PlaybackRequest("recording", r.id), name = p.title) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Picture(p.image, Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)))
            if (r.status == "recording") Icon(Icons.Default.FiberManualRecord, "Recording", Modifier.align(Alignment.TopStart).padding(4.dp).size(14.dp), tint = Color(0xFFE5484D))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            val sub = listOfNotNull(episodeLabel(p.season, p.episode), p.subtitle).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            Text(
                listOfNotNull(r.channelName, "${day(p.start)} ${clock(p.start)}", minutes(p.end - p.start), size(r.sizeBytes), if (r.watched == true) "Watched" else null).joinToString(" · "),
                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            r.error?.let { if (r.status == "failed") Text(it, maxLines = 2, style = MaterialTheme.typography.bodySmall, color = Color(0xFFFF8A80)) }
            if (entry != null && !entry.done) LinearProgressIndicator(progress = { entry.percent / 100f }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp).height(3.dp))
        }
        if (entry?.done == true) Icon(Icons.Default.DownloadDone, "Downloaded", Modifier.padding(8.dp), tint = MaterialTheme.colorScheme.primary)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (r.status == "completed" && entry == null) DropdownMenuItem(text = { Text("Download to this phone") }, onClick = {
                    menu = false
                    ui.download(PlaybackRequest("recording", r.id), OfflineMeta(kind = "recording", title = p.title, subtitle = listOfNotNull(r.channelName, day(p.start)).joinToString(" · "), artwork = p.image), false)
                })
                if (r.status == "completed") DropdownMenuItem(text = { Text(if (r.watched == true) "Mark as not watched" else "Mark as watched") }, onClick = {
                    menu = false
                    ui.scope.launch { runCatching { hub.markWatched(r.id, r.watched != true) }.onSuccess { reload() }.onFailure { ui.say(explain(it)) } }
                })
                DropdownMenuItem(text = { Text(if (r.status == "completed" || r.status == "failed") "Delete" else "Cancel") }, onClick = {
                    menu = false
                    ui.scope.launch {
                        val sure = ui.confirm(if (r.status == "completed") "Delete this recording?" else "Cancel this recording?", "${p.title} on ${r.channelName}. This can't be undone.", if (r.status == "completed") "Delete" else "Cancel it", "Keep")
                        if (sure) runCatching { hub.deleteRecording(r.id) }.onSuccess { reload() }.onFailure { ui.say(explain(it)) }
                    }
                })
            }
        }
    }
}

@Composable
fun DownloadsScreen(nav: NavHostController) {
    val entries by Offline.entries.collectAsState()
    var paused by remember { mutableStateOf(Offline.paused) }
    Column {
        Header("Downloads", nav)
        val used = size(Offline.usedBytes()) ?: "Nothing"
        val free = size(Offline.freeBytes()) ?: "0 MB"
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("$used saved · $free free", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (entries.any { !it.done }) TextButton(onClick = { paused = !paused; Offline.pause(paused) }) { Text(if (paused) "Resume all" else "Pause all") }
        }
        if (entries.isEmpty()) {
            Empty("Download films, episodes and recordings at home, then watch them anywhere. Look for the download button on a title or a recording.")
            return@Column
        }
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(entries, key = { it.item.id }) { e -> DownloadRow(e, paused) }
        }
    }
}

@Composable
private fun DownloadRow(e: OfflineEntry, paused: Boolean) {
    val ui = LocalUi.current
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val item = e.item
    val watched = Offline.position(item.progressKey)?.let { p -> p.durationMs?.let { d -> if (d > 0) p.positionMs.toFloat() / d else null } }
    Row(
        Modifier.fillMaxWidth().clickable(enabled = e.done) { PlayerActivity.playOffline(context, e) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Picture(item.artwork?.let { File(it) }, Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)))
            if (e.done && watched != null && watched > 0.01f) LinearProgressIndicator(progress = { watched.coerceIn(0f, 1f) }, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(4.dp).height(3.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            item.subtitle?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }
            val bytes = if (e.done) size(e.bytes) else listOfNotNull(size(e.bytes), size(item.sizeBytes)).joinToString(" of ").ifEmpty { null }
            Text(listOfNotNull(item.quality, bytes, status(e, paused)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = if (e.failure) Color(0xFFFF8A80) else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!e.done && !e.failure) LinearProgressIndicator(progress = { e.percent / 100f }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp).height(3.dp))
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (e.failure) DropdownMenuItem(text = { Text("Try again") }, onClick = { menu = false; Offline.retry(e) })
                DropdownMenuItem(text = { Text(if (e.done) "Delete download" else "Cancel download") }, onClick = {
                    menu = false
                    ui.scope.launch {
                        if (ui.confirm(if (e.done) "Delete this download?" else "Cancel this download?", "${item.title} comes off this phone. It stays on the Hub.", "Delete", "Keep")) Offline.remove(item.id)
                    }
                })
            }
        }
    }
}

private fun status(e: OfflineEntry, paused: Boolean): String? = when (e.state) {
    Download.STATE_COMPLETED -> null
    Download.STATE_FAILED -> "Failed"
    Download.STATE_DOWNLOADING -> "${e.percent.toInt()}%"
    Download.STATE_QUEUED, Download.STATE_STOPPED -> when {
        paused -> "Paused"
        (e.waitingFor and Requirements.NETWORK_UNMETERED) != 0 -> "Waiting for Wi-Fi"
        (e.waitingFor and Requirements.NETWORK) != 0 -> "Waiting for a connection"
        else -> "Queued"
    }
    Download.STATE_RESTARTING -> "Restarting"
    Download.STATE_REMOVING -> "Deleting"
    else -> null
}

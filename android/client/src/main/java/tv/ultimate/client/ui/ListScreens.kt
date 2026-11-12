// Saved for later and the play queue. Both lists live on the Hub, so the TV shows the same things:
// Saved for later is on the TV's Home, and the queue plays there in order.

package tv.ultimate.client.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import tv.ultimate.client.App
import tv.ultimate.client.PlayQueue
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.QueueItem
import tv.ultimate.client.SavedForLater
import tv.ultimate.client.WatchItem

/**
 * On Home: how much is saved and how much is waiting to play, with a way into both lists. The TV
 * has the same two (Saved for later is a rail on its Home, and the queue plays in order).
 */
@Composable
fun ListsBar(nav: NavHostController) {
    val ui = LocalUi.current
    val saved by SavedForLater.items.collectAsState()
    val queued by PlayQueue.items.collectAsState()
    LaunchedEffect(ui.online) {
        SavedForLater.load()
        PlayQueue.load()
    }
    // Three buttons don't fit across a small phone: the row scrolls sideways.
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = gutter(), vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(onClick = { nav.navigate("saved") { launchSingleTop = true } }) {
            Icon(Icons.Default.Bookmark, null)
            Spacer(Modifier.width(6.dp))
            Text(if (saved.isEmpty()) "Saved for later" else "Saved for later · ${saved.size}")
        }
        OutlinedButton(onClick = { nav.navigate("queue") { launchSingleTop = true } }) {
            Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null)
            Spacer(Modifier.width(6.dp))
            Text(if (queued.isEmpty()) "Queue" else "Queue · ${queued.size}")
        }
        // What the TV and the other phones and tablets are playing: carry on here, or Sync play.
        ElsewhereButton(nav)
    }
}

/**
 * Saved for later: films and shows kept for another evening. The TV has the same list on its Home,
 * so saving here shows up there, and pressing Red on the TV puts things here.
 */
@Composable
fun SavedScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val list = rememberLoad(ui.online) { hub.watchlist() }
    // The list is kept for other screens too (a title's page says whether it's saved), so it is
    // fetched again each time this screen opens.
    LaunchedEffect(Unit) { SavedForLater.load() }
    Column {
        Header("Saved", nav, back = true)
        Loaded(list) { state ->
            val items = state.items.orEmpty()
            if (items.isEmpty()) {
                Empty("Nothing saved for later yet. Open a film or show and choose Save for later, or press Red on the TV.")
                return@Loaded
            }
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Row(Modifier.padding(horizontal = gutter()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${items.size} ${if (items.size == 1) "thing" else "things"} saved", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = { nav.navigate("queue") { launchSingleTop = true } }) { Text("See the queue") }
                    }
                }
                items(items.size, key = { items[it].id }) { index ->
                    val item = items[index]
                    SavedRow(nav, item) { list.reload() }
                }
            }
        }
    }
}

@Composable
private fun SavedRow(nav: NavHostController, item: WatchItem, reload: () -> Unit) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val t = item.title
    Row(
        Modifier.fillMaxWidth()
            .tvClickable(enabled = t != null) { if (t != null) details(nav, t.id) }
            .padding(horizontal = gutter(), vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Picture(t?.poster ?: t?.backdrop, Modifier.width(56.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainer))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(t?.name ?: item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            val kind = when (item.kind) {
                "series" -> "TV show"
                "movie" -> "Film"
                else -> null
            }
            val sub = listOfNotNull(kind, item.year?.toString()).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            // Something on the channels soon says when, in the guide's own words.
            item.next?.let { n -> Text(n.whenText ?: "On ${n.channelName}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }
            if (t == null) Text("The Hub couldn't find this one any more", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (t != null) {
            IconButton(onClick = { ui.play(PlaybackRequest("title", t.id), t) }) { Icon(Icons.Default.PlayArrow, "Play on this phone") }
            IconButton(onClick = { ui.addToQueue(PlaybackRequest("title", t.id), t, t.name, t.year?.toString(), t.poster ?: t.backdrop) }) {
                Icon(Icons.AutoMirrored.Filled.PlaylistAdd, "Add to queue")
            }
        }
        item.next?.let { n ->
            IconButton(onClick = {
                ui.scope.launch {
                    runCatching { hub.record(n.programmeId) }
                        .onSuccess { ui.say("Recording it on ${n.channelName}") }
                        .onFailure { ui.say(explain(it)) }
                }
            }) { Icon(Icons.Default.FiberManualRecord, "Record it") }
            IconButton(onClick = {
                ui.scope.launch {
                    runCatching { hub.remind(n.programmeId) }
                        .onSuccess { ui.say("This phone will remind you about it") }
                        .onFailure { ui.say(explain(it)) }
                }
            }) { Icon(Icons.Default.NotificationsActive, "Remind me") }
        }
        IconButton(onClick = {
            ui.scope.launch {
                runCatching { SavedForLater.remove(item.id) }
                    .onSuccess { ui.say("${t?.name ?: item.name} taken off Saved for later"); reload() }
                    .onFailure { ui.say(explain(it)) }
            }
        }) { Icon(Icons.Default.Delete, "Take off Saved for later") }
    }
    HorizontalDivider()
}

/**
 * The queue: what plays after what's on now. Kids see their own part of it, because the Hub leaves
 * out anything a Kids profile may not watch.
 */
@Composable
fun QueueScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val list = rememberLoad(ui.online) { hub.queue() }
    LaunchedEffect(Unit) { PlayQueue.load() }
    Column {
        Header("Queue", nav, back = true)
        Loaded(list) { state ->
            val items = state.queue.orEmpty()
            if (items.isEmpty()) {
                Empty("Nothing queued. Open a film or show and choose Add to queue, and they play one after another on the TV.")
                return@Loaded
            }
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Row(Modifier.padding(horizontal = gutter()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Plays in this order on the TV", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = { nav.navigate("saved") { launchSingleTop = true } }) { Text("Saved") }
                        TextButton(onClick = {
                            ui.scope.launch {
                                val sure = ui.confirm(
                                    "Clear the queue?",
                                    "This takes all ${items.size} off the queue. The films and episodes themselves stay where they are.",
                                    "Clear it",
                                    "Keep it",
                                )
                                if (sure) {
                                    runCatching { PlayQueue.clear() }
                                        .onSuccess { ui.say("Queue cleared"); list.reload() }
                                        .onFailure { ui.say(explain(it)) }
                                }
                            }
                        }) { Text("Clear the queue") }
                    }
                }
                items(items.size, key = { items[it].id }) { index ->
                    val item = items[index]
                    QueueRow(index, item) { list.reload() }
                }
            }
        }
    }
}

@Composable
private fun QueueRow(index: Int, item: QueueItem, reload: () -> Unit) {
    val ui = LocalUi.current
    Row(Modifier.fillMaxWidth().padding(horizontal = gutter(), vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${index + 1}", Modifier.width(22.dp), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Picture(item.image ?: item.title?.poster, Modifier.width(88.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainer))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            item.subtitle?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text(if (index == 0) "Plays next" else "Number ${index + 1}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
        IconButton(onClick = { ui.play(item.req, item.title, item.name) }) { Icon(Icons.Default.PlayArrow, "Play on this phone") }
        IconButton(onClick = { ui.playOnTv(item.req, item.title) }) { Icon(Icons.Default.Tv, "Play on the TV") }
        if (index > 0) {
            IconButton(onClick = {
                ui.scope.launch {
                    // Up one, or straight to the front when it's second (the phone remote's ↑).
                    runCatching { PlayQueue.move(item.id, if (index == 1) 0 else index - 1) }
                        .onSuccess { reload() }
                        .onFailure { ui.say(explain(it)) }
                }
            }) { Icon(Icons.Default.ArrowUpward, "Move up") }
        }
        IconButton(onClick = {
            ui.scope.launch {
                runCatching { PlayQueue.remove(item.id) }
                    .onSuccess { ui.say("${item.name} taken off the queue"); reload() }
                    .onFailure { ui.say(explain(it)) }
            }
        }) { Icon(Icons.Default.Delete, "Take off the queue") }
    }
    HorizontalDivider()
}

// Watching elsewhere: what the TVs and the other phones and tablets are playing, with Resume here
// (carry on from the same place), Move here (and stop it there), Sync play (the same thing on both,
// pausing and skipping together) and, for another phone's film, On the TV.

package tv.ultimate.client.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.ultimate.client.App
import tv.ultimate.client.WatchSession
import tv.ultimate.client.WatchingState
import tv.ultimate.client.clockLabel
import tv.ultimate.client.placeAt

/** "Living room · paused at 42:10 of 2:16:00". */
private fun watchLine(s: WatchSession, place: Long): String {
    val who = s.deviceName ?: "Another screen"
    if (s.live) return if (s.stopped) "$who · was watching live" else "$who · watching live"
    val at = clockLabel(place) + (s.durationMs?.let { " of ${clockLabel(it)}" } ?: "")
    val what = when {
        s.stopped -> "stopped at"
        s.paused -> "paused at"
        else -> "at"
    }
    return "$who · $what $at"
}

/** On Home: a way in, with how many screens are playing something now. */
@Composable
fun ElsewhereButton(nav: NavHostController) {
    val ui = LocalUi.current
    var count by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(ui.online) {
        while (ui.online) {
            count = runCatching { App.instance.hub.watching().sessions.orEmpty().count { !it.stopped } }.getOrNull()
            delay(20_000)
        }
    }
    OutlinedButton(onClick = { nav.navigate("elsewhere") { launchSingleTop = true } }) {
        Icon(Icons.Default.Devices, null)
        Spacer(Modifier.width(6.dp))
        Text(count?.takeIf { it > 0 }?.let { "Elsewhere · $it" } ?: "Elsewhere")
    }
}

@Composable
fun ElsewhereScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    var state by remember { mutableStateOf<WatchingState?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var offset by remember { mutableLongStateOf(0L) }
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(ui.online, tick) {
        while (true) {
            runCatching { hub.watching() }
                .onSuccess { s ->
                    state = s
                    error = null
                    s.now?.let { offset = it - System.currentTimeMillis() }
                }
                .onFailure { error = it }
            delay(5000)
        }
    }
    Column {
        Header("Watching elsewhere", nav, back = true)
        val s = state
        val e = error
        when {
            s == null && e != null -> Problem(e) { tick++ }
            s == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.sessions.isNullOrEmpty() -> Empty("Nothing is playing on the other screens. Start something on the TV or another phone or tablet and it shows up here.")
            else -> {
                val sessions = s.sessions
                LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    item {
                        Text(
                            "Carry on from another screen, or watch together with Sync play: pausing or skipping on one does both.",
                            Modifier.padding(horizontal = gutter(), vertical = 4.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(sessions.size, key = { sessions[it].device }) { i -> ElsewhereRow(sessions[i], offset) }
                }
            }
        }
    }
}

@Composable
private fun ElsewhereRow(s: WatchSession, offset: Long) {
    val ui = LocalUi.current
    val hub = App.instance.hub
    val place = if (s.stopped || s.live) s.positionMs else placeAt(s.positionMs, s.paused, s.at, s.durationMs, System.currentTimeMillis() + offset)
    val isTv = s.client == "tv" || s.box != null
    Column(Modifier.fillMaxWidth().padding(horizontal = gutter(), vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Picture(s.artwork ?: s.title?.backdrop ?: s.title?.poster, Modifier.width(112.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainer))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(s.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                s.subtitle?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(
                    watchLine(s, place) + (s.profile?.name?.let { " · $it" } ?: "") + (if (s.sync != null) " · Sync play" else ""),
                    maxLines = 2,
                    style = MaterialTheme.typography.bodySmall,
                )
                val d = s.durationMs
                if (!s.live && d != null && d > 0) {
                    Spacer(Modifier.height(4.dp))
                    LinearProgressIndicator(progress = { (place.toFloat() / d).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = { ui.play(s.req, s.title, s.name, startMs = if (s.live) null else maxOf(0L, place - 2000)) }) {
                Text(if (s.live) "Watch here" else "Resume here")
            }
            if (!s.stopped) {
                TextButton(onClick = {
                    ui.play(s.req, s.title, s.name, startMs = if (s.live) null else maxOf(0L, place - 2000))
                    ui.scope.launch { runCatching { hub.watchCommand(s.device, "stop") } }
                }) { Text("Move here") }
                TextButton(onClick = {
                    ui.scope.launch {
                        runCatching { hub.startSync(s.device) }
                            .onSuccess { reply ->
                                val g = reply.group ?: return@onSuccess
                                val start = if (g.live) null else placeAt(g.positionMs, g.paused, g.at, g.durationMs, reply.now ?: (System.currentTimeMillis() + offset))
                                ui.play(g.req, g.title, g.name, startMs = start, sync = g.id)
                            }
                            .onFailure { ui.say(explain(it)) }
                    }
                }) { Text("Sync play") }
            }
            // Another phone or tablet's film, on the TV.
            if (!isTv) {
                TextButton(onClick = {
                    ui.scope.launch {
                        runCatching { hub.tvWatchHere(s.device, "resume") }
                            .onSuccess { ui.say("Playing on the TV") }
                            .onFailure { ui.say(explain(it)) }
                    }
                }) { Text("On the TV") }
            }
        }
    }
    HorizontalDivider()
}

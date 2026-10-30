// What's new: the Hub's CHANGELOG.md. After an update a pop-up lists what this phone hasn't shown
// yet (the Hub works it out from the newest change seen); Settings › What's new lists everything.

package tv.ultimate.client.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import tv.ultimate.client.App
import tv.ultimate.client.ChangeEntry
import tv.ultimate.client.ChangeRelease
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK)

/** "30 Oct 2026", or "0.2.0 · 24 Oct 2026" for a versioned section. */
private fun label(r: ChangeRelease): String {
    val day = r.date?.let { runCatching { LocalDate.parse(it).format(DAY) }.getOrNull() }
    return listOfNotNull(r.version, day).joinToString(" · ").ifEmpty { r.id }
}

@Composable
private fun Change(e: ChangeEntry) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(e.title, fontWeight = FontWeight.SemiBold)
            e.text?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
fun WhatsNewScreen(nav: NavHostController) {
    val app = App.instance
    val log = rememberLoad { app.hub.changelog() }
    Column {
        Header("What's new", nav, back = true)
        Loaded(log) { l ->
            LaunchedEffect(l.latest) { l.latest?.let { app.prefs.changesSeen = it } }
            val releases = l.releases.orEmpty()
            if (releases.isEmpty()) {
                Text("This Hub doesn't have a change log.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (r in releases) {
                    item { Text(label(r), Modifier.padding(top = 12.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }
                    r.note?.takeIf { it.isNotBlank() }?.let { note -> item { Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                    items(r.entries.orEmpty()) { e -> Change(e) }
                }
            }
        }
    }
}

/** Once the Hub answers: the changes since this phone last looked, unless a Kids profile is watching. */
@Composable
fun WhatsNewPopup(nav: NavHostController, online: Boolean) {
    val app = App.instance
    var fresh by remember { mutableStateOf<Pair<String, List<ChangeEntry>>?>(null) }
    LaunchedEffect(online) {
        if (!online || app.prefs.profileKind == "kids") return@LaunchedEffect
        val log = runCatching { app.hub.changelog(app.prefs.changesSeen ?: "") }.getOrNull() ?: return@LaunchedEffect
        val latest = log.latest ?: return@LaunchedEffect
        val unseen = log.unseen.orEmpty()
        if (unseen.isEmpty()) app.prefs.changesSeen = latest else fresh = latest to unseen
    }
    fresh?.let { (latest, changes) ->
        val close = { all: Boolean ->
            app.prefs.changesSeen = latest
            fresh = null
            if (all) nav.navigate("whatsnew")
        }
        AlertDialog(
            onDismissRequest = { close(false) },
            title = { Text("What's new") },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (changes.size == 1) "One change since you last looked." else "${changes.size} changes since you last looked.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    changes.take(12).forEach { Change(it) }
                }
            },
            confirmButton = { TextButton(onClick = { close(false) }) { Text("Got it") } },
            dismissButton = { TextButton(onClick = { close(true) }) { Text("See all") } },
        )
    }
}

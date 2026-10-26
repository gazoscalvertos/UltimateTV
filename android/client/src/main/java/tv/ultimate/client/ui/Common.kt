// Pieces every screen uses: loading from the Hub, posters and rails, and the formatting of times
// and sizes.

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import tv.ultimate.client.ApiError
import tv.ultimate.client.App
import tv.ultimate.client.NowNext
import tv.ultimate.client.Recording
import tv.ultimate.client.TitleRef
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val value: T) : Load<T>
    data class Err(val error: Throwable) : Load<Nothing>
}

class Loader<T>(val state: Load<T>, val reload: () -> Unit)

/** Runs `block` when the keys change (or reload() is called) and remembers the answer. */
@Composable
fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> T): Loader<T> {
    var generation by remember { mutableIntStateOf(0) }
    val state by produceState<Load<T>>(Load.Loading, *keys, generation) {
        if (value !is Load.Ok) value = Load.Loading
        value = try {
            Load.Ok(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Load.Err(e)
        }
    }
    return Loader(state) { generation++ }
}

@Composable
fun <T> Loaded(loader: Loader<T>, content: @Composable (T) -> Unit) {
    when (val s = loader.state) {
        is Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Err -> Problem(s.error, loader.reload)
        is Load.Ok -> content(s.value)
    }
}

fun explain(e: Throwable): String = when (e) {
    is ApiError -> if (e.code == "pair" && e.status == 401) "Pair this phone with the TV first: Settings › Pair with the TV" else e.message ?: "The Hub said no"
    is java.net.ConnectException, is java.net.SocketTimeoutException, is java.net.UnknownHostException, is java.net.NoRouteToHostException ->
        "Can't reach the Hub. Is the phone on the home Wi-Fi?"
    else -> e.message ?: "Something went wrong"
}

@Composable
fun Problem(e: Throwable, retry: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.CloudOff, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text(explain(e), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (retry != null) {
            Spacer(Modifier.height(16.dp))
            Button(onClick = retry) { Text("Try again") }
        }
    }
}

@Composable
fun Empty(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun isWide(): Boolean = LocalConfiguration.current.screenWidthDp >= 600

@Composable
fun posterWidth(): Dp = if (isWide()) 140.dp else 112.dp

/** A Hub image (relative paths become absolute), or a saved file. */
@Composable
fun Picture(model: Any?, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop) {
    val m = if (model is String) App.instance.hub.abs(model) else model
    Box(modifier.background(Color(0xFF1A2333))) {
        if (m != null) AsyncImage(model = m, contentDescription = null, contentScale = scale, modifier = Modifier.fillMaxSize())
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp))
}

@Composable
fun Poster(t: TitleRef, onClick: () -> Unit) {
    val w = posterWidth()
    Column(Modifier.width(w).clickable(onClick = onClick)) {
        Box {
            Picture(t.poster ?: t.backdrop, Modifier.width(w).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)))
            t.progress?.let { p ->
                if (p > 0.01) LinearProgressIndicator(progress = { p.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp).height(3.dp))
            }
        }
        Text(t.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
        val sub = t.subtitle ?: t.year?.toString()
        if (sub != null) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun PosterRail(title: String, items: List<TitleRef>, open: (TitleRef) -> Unit) {
    if (items.isEmpty()) return
    SectionTitle(title)
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(items, key = { it.id }) { Poster(it) { open(it) } }
    }
}

@Composable
fun ChannelCard(n: NowNext, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.width(220.dp).clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Picture(n.channel.logo, Modifier.size(40.dp, 28.dp), ContentScale.Fit)
                Spacer(Modifier.width(8.dp))
                Text("${n.channel.number}  ${n.channel.name}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.height(8.dp))
            Text(n.now?.title ?: "No information", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            n.now?.let { p -> LinearProgressIndicator(progress = { progressOf(p.start, p.end) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(3.dp)) }
        }
    }
}

@Composable
fun RecordingCard(r: Recording, onClick: () -> Unit) {
    Column(Modifier.width(200.dp).clickable(onClick = onClick)) {
        Picture(r.programme.image, Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)))
        Text(r.programme.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
        Text("${r.channelName} · ${day(r.programme.start)}", maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// -------------------------------------------------------------------------
// Formatting

fun progressOf(start: Long, end: Long, now: Long = System.currentTimeMillis()): Float =
    if (end <= start) 0f else ((now - start).toFloat() / (end - start)).coerceIn(0f, 1f)

fun clock(ms: Long): String = SimpleDateFormat("HH:mm", Locale.UK).format(Date(ms))

/** "Today", "Tomorrow", "Yesterday" or "Sat 25 Oct". */
fun day(ms: Long): String {
    val c = Calendar.getInstance()
    val today = c.get(Calendar.DAY_OF_YEAR) + c.get(Calendar.YEAR) * 400
    c.timeInMillis = ms
    val that = c.get(Calendar.DAY_OF_YEAR) + c.get(Calendar.YEAR) * 400
    return when (that - today) {
        0 -> "Today"
        1 -> "Tomorrow"
        -1 -> "Yesterday"
        else -> SimpleDateFormat("EEE d MMM", Locale.UK).format(Date(ms))
    }
}

fun minutes(ms: Long): String {
    val m = (ms / 60_000).toInt()
    return if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m"
}

fun size(bytes: Long?): String? {
    if (bytes == null || bytes <= 0) return null
    val gb = bytes / 1_000_000_000.0
    return if (gb >= 1) String.format(Locale.UK, "%.1f GB", gb) else "${bytes / 1_000_000} MB"
}

fun episodeLabel(season: Int?, episode: Int?): String? = if (season != null && episode != null) "S$season E$episode" else null

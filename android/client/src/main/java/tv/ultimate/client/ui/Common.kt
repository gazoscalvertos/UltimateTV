// Pieces every screen uses: loading from the Hub, posters and rails, and the formatting of times
// and sizes.

package tv.ultimate.client.ui

import androidx.compose.foundation.background
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.sp
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

/** A poster is 13.5 rem wide on the TV; a tablet's are a little larger than a phone's. */
@Composable
fun posterWidth(): Dp = if (rememberIsTv()) 135.dp else if (isWide()) 140.dp else 112.dp

/** The wide cards (channels, recordings, Continue watching): 24 rem on the TV. */
@Composable
fun wideCardWidth(): Dp = if (rememberIsTv()) 240.dp else if (isWide()) 240.dp else 200.dp

@Composable
private fun artShape(): RoundedCornerShape = RoundedCornerShape(if (rememberIsTv()) 8.dp else 10.dp)

/** A Hub image (relative paths become absolute), or a saved file. */
@Composable
fun Picture(model: Any?, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop) {
    val m = if (model is String) App.instance.hub.abs(model) else model
    val c = LocalUtv.current
    Box(modifier.background(c.panel)) {
        if (m != null) AsyncImage(model = m, contentDescription = null, contentScale = scale, modifier = Modifier.fillMaxSize())
    }
}

/** A picture that falls back to the name on a plain card, as the TV does when there is no artwork. */
@Composable
private fun Art(model: Any?, name: String, modifier: Modifier) {
    val c = LocalUtv.current
    if (model == null) {
        Box(modifier.background(Brush.linearGradient(listOf(c.panel2, c.panel))).padding(8.dp), contentAlignment = Alignment.Center) {
            Text(name, color = c.muted, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis, fontSize = if (rememberIsTv()) 12.sp else 14.sp)
        }
    } else Picture(model, modifier)
}

/** A rail's title: 1.55 rem, as on the TV. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    if (text.isBlank()) return
    val c = LocalUtv.current
    val tv = rememberIsTv()
    Text(
        text,
        color = c.fg,
        fontSize = if (tv) 15.5.sp else 18.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier.padding(start = gutter(), end = gutter(), top = if (tv) 14.dp else 20.dp, bottom = if (tv) 4.dp else 6.dp),
    )
}

/**
 * A card the remote can land on. The picture lifts and gets a white ring when focused, and the
 * name stays put underneath, as on the TV. [content] draws the picture; [label] the lines below.
 */
@Composable
private fun FocusCard(onClick: () -> Unit, width: Dp, art: @Composable (Modifier) -> Unit, label: @Composable () -> Unit) {
    val c = LocalUtv.current
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.07f else 1f, label = "cardFocus")
    val shape = artShape()
    Column(
        Modifier.width(width).onFocusChanged { focused = it.isFocused }.clickable(onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .then(if (focused) Modifier.border(2.5.dp, c.focus, shape) else Modifier)
                .clip(shape),
        ) { art(Modifier) }
        label()
    }
}

@Composable
private fun CardLabel(title: String, sub: String?, modifier: Modifier = Modifier) {
    val c = LocalUtv.current
    val tv = rememberIsTv()
    Column(modifier.padding(horizontal = 2.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(title, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, fontSize = if (tv) 11.5.sp else 14.sp)
        if (!sub.isNullOrBlank()) Text(sub, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = if (tv) 10.sp else 12.sp)
    }
}

@Composable
private fun Badge(text: String, modifier: Modifier = Modifier, fill: Color = Color(0xA6000000)) {
    Text(
        text,
        modifier.clip(RoundedCornerShape(4.dp)).background(fill).padding(horizontal = 5.dp, vertical = 2.dp),
        color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (rememberIsTv()) 8.5.sp else 10.sp, maxLines = 1,
    )
}

@Composable
fun Poster(t: TitleRef, onClick: () -> Unit) {
    val c = LocalUtv.current
    FocusCard(
        onClick, posterWidth(),
        art = {
            Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f)) {
                Art(t.poster ?: t.backdrop, t.name, Modifier.fillMaxSize())
                t.badges?.firstOrNull()?.let { Badge(it, Modifier.align(Alignment.TopStart).padding(6.dp)) }
                t.progress?.let { p ->
                    if (p > 0.01) LinearProgressIndicator(
                        progress = { p.toFloat().coerceIn(0f, 1f) },
                        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(8.dp).height(3.5.dp).clip(RoundedCornerShape(2.dp)),
                        color = c.accent,
                        trackColor = c.lift(0.22f),
                    )
                }
            }
        },
        label = { CardLabel(t.name, t.subtitle ?: t.year?.toString()) },
    )
}

/** A rail of posters (or nothing, if there are none). */
@Composable
fun PosterRail(title: String, items: List<TitleRef>, open: (TitleRef) -> Unit) {
    if (items.isEmpty()) return
    SectionTitle(title)
    // Room above and below, so a lifted poster and its ring aren't cut off by the edge of the row.
    LazyRow(contentPadding = PaddingValues(start = gutter(), end = gutter(), top = 8.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(if (rememberIsTv()) 14.dp else 12.dp)) {
        items(items) { Poster(it) { open(it) } }
    }
}

@Composable
fun ChannelCard(n: NowNext, onClick: () -> Unit) {
    val c = LocalUtv.current
    FocusCard(
        onClick, wideCardWidth(),
        art = {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                Art(n.now?.image, n.channel.name, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x73000000), Color.Transparent, Color.Transparent, Color(0x99000000)))))
                if (n.channel.logo != null) Picture(n.channel.logo, Modifier.align(Alignment.TopStart).padding(7.dp).size(34.dp, 22.dp).background(Color.Transparent), ContentScale.Fit)
                else Badge(n.channel.name, Modifier.align(Alignment.TopStart).padding(7.dp))
                Text("${n.channel.number}", Modifier.align(Alignment.TopEnd).padding(8.dp), color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (rememberIsTv()) 11.sp else 12.sp)
                n.now?.let { p ->
                    LinearProgressIndicator(
                        progress = { progressOf(p.start, p.end) },
                        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(8.dp).height(3.5.dp).clip(RoundedCornerShape(2.dp)),
                        color = c.accent,
                        trackColor = Color(0x55FFFFFF),
                    )
                }
            }
        },
        label = { CardLabel(n.now?.title ?: "No information", n.channel.name + (n.now?.let { " · until ${clock(it.end)}" } ?: "")) },
    )
}

@Composable
fun RecordingCard(r: Recording, onClick: () -> Unit) {
    FocusCard(
        onClick, wideCardWidth(),
        art = {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                Art(r.programme.image, r.programme.title, Modifier.fillMaxSize())
                if (r.watched != true) Badge("New", Modifier.align(Alignment.TopStart).padding(7.dp), LocalUtv.current.accent)
            }
        },
        label = { CardLabel(r.programme.title, listOfNotNull(episodeLabel(r.programme.season, r.programme.episode), r.channelName, day(r.programme.start)).joinToString(" · ")) },
    )
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

// The menu. On a TV and a tablet it is the TV app's own top bar: the app's name, pill tabs, the
// clock and who's watching. On a phone there is a slim bar with the name, Search and Settings, and
// the tabs go along the bottom where a thumb reaches them.

package tv.ultimate.client.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import tv.ultimate.client.App

class NavTab(val route: String, val label: String, val icon: ImageVector)

/** The app's mark and name: the first letter on a gradient, as on the TV. */
@Composable
private fun Brand() {
    val c = LocalUtv.current
    val ui = LocalUi.current
    val tv = rememberIsTv()
    val size = if (tv) 24.dp else 30.dp
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (tv) 8.dp else 10.dp)) {
        Box(
            Modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(Brush.linearGradient(listOf(c.accent, c.accent2))),
            contentAlignment = Alignment.Center,
        ) {
            Text(ui.appName.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = if (tv) 14.sp else 17.sp)
        }
        Text(ui.appName, color = c.fg, fontWeight = FontWeight.ExtraBold, fontSize = if (tv) 15.sp else 18.sp, maxLines = 1)
    }
}

/** One tab. Text, or an icon on its own (Search). Quiet when idle, underlined when it is the page you are on, solid under the remote. */
@Composable
private fun Pill(label: String?, icon: ImageVector?, active: Boolean, description: String, onClick: () -> Unit) {
    val c = LocalUtv.current
    val tv = rememberIsTv()
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "pillFocus")
    val ink = if (focused) c.onSel else if (active) c.fg else c.muted
    val shape = RoundedCornerShape(if (tv) 15.dp else 18.dp)
    Row(
        Modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .height(if (tv) 30.dp else 36.dp)
            .clip(shape)
            .background(if (focused) c.sel else Color.Transparent)
            .drawBehind {
                if (active && !focused) drawRect(c.accent, topLeft = Offset(size.width * 0.15f, size.height - 2.dp.toPx()), size = Size(size.width * 0.7f, 2.dp.toPx()))
            }
            .clickable(onClick = onClick)
            .padding(horizontal = if (label == null) 11.dp else if (tv) 13.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, description, Modifier.size(if (tv) 16.dp else 20.dp), tint = ink)
        if (label != null) Text(label, color = ink, fontWeight = FontWeight.SemiBold, fontSize = if (tv) 12.5.sp else 14.sp, maxLines = 1)
    }
}

/** Who's watching: tap to change profile. */
@Composable
private fun Avatar(nav: NavHostController) {
    val c = LocalUtv.current
    val tv = rememberIsTv()
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.15f else 1f, label = "avatarFocus")
    val name = App.instance.prefs.profileName.orEmpty()
    val size = if (tv) 26.dp else 32.dp
    Box(
        Modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .size(size)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(c.accent, c.accent2)))
            .then(if (focused) Modifier.border(2.dp, c.focus, CircleShape) else Modifier)
            .clickable { nav.navigate("profiles") },
        contentAlignment = Alignment.Center,
    ) {
        Text(name.take(1).uppercase().ifEmpty { "?" }, color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (tv) 12.sp else 14.sp)
    }
}

@Composable
private fun Clock() {
    val c = LocalUtv.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(20_000)
        }
    }
    Text(clock(now), color = c.muted, fontWeight = FontWeight.SemiBold, fontSize = if (rememberIsTv()) 15.sp else 16.sp)
}

/** The TV app's top bar, for a TV and a tablet. */
@Composable
fun TopBar(nav: NavHostController, route: String?, tabs: List<NavTab>) {
    val ui = LocalUi.current
    val tv = rememberIsTv()
    Row(
        Modifier.fillMaxWidth().height(if (tv) 60.dp else 60.dp).padding(horizontal = gutter()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (tv) 20.dp else 16.dp),
    ) {
        Brand()
        // Tabs that don't fit (a small tablet) scroll sideways; the padding keeps a lifted pill from being cut off.
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (t in tabs) Pill(t.label, null, route == t.route, t.label) { go(nav, t.route) }
            if (ui.on("search")) Pill(null, Icons.Default.Search, route == "search", "Search") { go(nav, "search") }
            Pill("Settings", null, route == "settings", "Settings") { go(nav, "settings") }
        }
        Clock()
        Avatar(nav)
    }
}

/** A phone's top bar: the name, Search, Settings and who's watching. */
@Composable
fun PhoneBar(nav: NavHostController, route: String?) {
    val ui = LocalUi.current
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(horizontal = gutter()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.weight(1f)) { Brand() }
        if (ui.on("search")) Pill(null, Icons.Default.Search, route == "search", "Search") { go(nav, "search") }
        Pill(null, Icons.Default.Settings, route == "settings", "Settings") { go(nav, "settings") }
        Avatar(nav)
    }
}

/** A phone's tabs, along the bottom. */
@Composable
fun BottomTabs(nav: NavHostController, route: String?, tabs: List<NavTab>) {
    val c = LocalUtv.current
    NavigationBar(containerColor = c.panel) {
        for (t in tabs) NavigationBarItem(
            selected = route == t.route,
            onClick = { go(nav, t.route) },
            icon = { Icon(t.icon, null) },
            label = { Text(t.label, maxLines = 1, fontSize = 11.sp) },
            colors = NavigationBarItemDefaults.colors(
                selectedIconColor = c.fg,
                selectedTextColor = c.fg,
                unselectedIconColor = c.muted,
                unselectedTextColor = c.muted,
                indicatorColor = c.accent.copy(alpha = 0.3f),
            ),
        )
    }
}

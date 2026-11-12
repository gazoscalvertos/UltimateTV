package tv.ultimate.client.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import tv.ultimate.client.App
import tv.ultimate.client.Hub
import tv.ultimate.client.Offline

/** Whether a screen is switched off on this phone (Settings › Features on this phone). */
private fun routeOn(ui: Ui, route: String?): Boolean = when (route?.substringBefore('/')) {
    "guide", "channel" -> ui.on("live")
    "library" -> ui.on("films") || ui.on("shows")
    "films" -> ui.on("films")
    "shows" -> ui.on("shows")
    "recordings" -> ui.on("recordings")
    "downloads" -> ui.on("downloads")
    "search" -> ui.on("search")
    else -> true
}

// A TV and a tablet have the TV app's tabs: Films and TV Shows apart. A phone has one tab for both,
// with the choice at the top of the screen, because six tabs don't fit along the bottom.
private val TABS_WIDE = listOf(
    NavTab("home", "Home", Icons.Default.Home),
    NavTab("guide", "TV Guide", Icons.Default.LiveTv),
    NavTab("films", "Films", Icons.Default.Movie),
    NavTab("shows", "TV Shows", Icons.Default.VideoLibrary),
    NavTab("recordings", "Recordings", Icons.Default.FiberManualRecord),
    NavTab("downloads", "Downloads", Icons.Default.DownloadForOffline),
)

private val TABS_PHONE = listOf(
    NavTab("home", "Home", Icons.Default.Home),
    NavTab("guide", "TV Guide", Icons.Default.LiveTv),
    NavTab("library", "Films & TV", Icons.Default.Movie),
    NavTab("recordings", "Recordings", Icons.Default.FiberManualRecord),
    NavTab("downloads", "Downloads", Icons.Default.DownloadForOffline),
)

class MainActivity : ComponentActivity() {
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread { notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }

    /** The remote's Menu key (the three lines) opens Settings, wherever focus is. */
    var onMenuKey: (() -> Unit)? = null

    override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_MENU) { onMenuKey?.invoke(); return true }
        return super.onKeyUp(keyCode, event)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 15 draws every app edge to edge anyway; doing it on older phones too keeps one layout,
        // with light status bar icons on the dark app. The Scaffold below pads for the bars once.
        enableEdgeToEdge(SystemBarStyle.dark(0xFF070B14.toInt()), SystemBarStyle.dark(0xFF070B14.toInt()))
        val startTab = intent.getStringExtra("tab")
        setContent {
            val snackbar = remember { SnackbarHostState() }
            val scope = rememberCoroutineScope()
            val context = LocalContext.current
            val ui = remember { Ui(context, scope, snackbar, ::askNotifications) }
            val tv = rememberIsTv()
            val wide = isWide()
            val density = LocalDensity.current
            // A TV is drawn on a fixed canvas, 120 × 67.5 rem like the TV app's own screens (1 rem = 10 dp
            // here), so it looks the same on a 720p stick and a 4K one and the sizes in the code can be
            // read straight off the TV's stylesheet. A phone or tablet keeps its own density.
            val sized = if (tv) {
                val dm = context.resources.displayMetrics
                Density(minOf(dm.widthPixels / 1200f, dm.heightPixels / 675f), 1f)
            } else density
            val base = MaterialTheme.typography
            CompositionLocalProvider(
                LocalUi provides ui,
                LocalUtv provides ui.theme,
                LocalDensity provides sized,
                LocalGutter provides (if (tv) 60.dp else if (wide) 32.dp else 16.dp),
            ) {
                MaterialTheme(colorScheme = ui.theme.scheme(), typography = if (tv) base.scaled(0.85f) else base) {
                    Root(ui, snackbar, startTab)
                }
            }
        }
    }
}

@Composable
private fun Root(ui: Ui, snackbar: SnackbarHostState, startTab: String?) {
    val nav = rememberNavController()
    val app = App.instance
    val lifecycle = LocalLifecycleOwner.current
    val context = LocalContext.current
    var checkedUpdate by remember { mutableStateOf(false) }

    // Whether we're at home: checked whenever the app comes back to the front, and progress
    // watched away is sent to the Hub as soon as it answers.
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val reachable = app.hub.reachable()
            val wasOnline = ui.online
            ui.online = reachable
            if (reachable) {
                app.hub.runCatching { appName() }.getOrNull()?.let { name ->
                    ui.appName = name
                    app.prefs.appName = name
                }
                ui.loadFeatures()
                ui.loadTheme()
                Offline.syncPositions(app.hub)
                // Who's watching comes first, and the update question never waits in front of it.
                if (app.prefs.profileId == null && nav.currentDestination?.route != "profiles") nav.navigate("profiles")
                if (!checkedUpdate) {
                    checkedUpdate = true
                    ui.scope.launch { offerUpdate(context, app, ui, quiet = true) }
                }
            } else if (wasOnline || startTab == null) {
                if (Offline.entries.value.isNotEmpty()) go(nav, "downloads")
            }
        }
    }

    DisposableEffect(nav) {
        val a = context as? MainActivity
        a?.onMenuKey = { go(nav, "settings") }
        onDispose { a?.onMenuKey = null }
    }
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val tv = rememberIsTv()
    val wide = isWide()
    // Held upright, a tablet gets the phone's layout (tabs along the bottom): the top bar needs the width.
    val upright = LocalConfiguration.current.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT
    val topMenu = tv || (wide && !upright)
    val colours = LocalUtv.current
    val showBars = route != "profiles"
    val tabs = (if (topMenu) TABS_WIDE else TABS_PHONE).filter { routeOn(ui, it.route) }
    // A screen switched off here (from Settings, the Hub, or a link into the app) goes back Home.
    LaunchedEffect(route, ui.featuresOff) { if (route != null && !routeOn(ui, route)) go(nav, "home") }

    // The TV's backdrop: the theme's colour with a soft glow at the top.
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to colours.glow, 0.5f to colours.bg, 1f to colours.bg))) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            containerColor = Color.Transparent,
            // The status bar, nav bar and (in landscape) the camera cut-out, applied here only once.
            contentWindowInsets = WindowInsets.safeDrawing,
            bottomBar = { if (!topMenu && showBars) BottomTabs(nav, route, tabs) },
        ) { pad ->
            // A TV can crop the edge of the picture (overscan): keep a little clear at the top and bottom.
            // The sides are the screens' own gutter, 6rem like the TV app.
            val safe = if (tv) Modifier.padding(top = 8.dp, bottom = 12.dp) else Modifier
            Column(Modifier.fillMaxSize().padding(pad).then(safe)) {
                if (showBars) {
                    if (topMenu) TopBar(nav, route, tabs) else PhoneBar(nav, route)
                }
                if (!ui.online && route != "downloads" && route != "settings" && ui.on("downloads")) OfflineBanner { go(nav, "downloads") }
                // On a TV the remote has to start somewhere: this puts focus on the first thing
                // in the new screen whenever the route changes. On a phone it does nothing.
                Box(Modifier.weight(1f).fillMaxWidth().tvLanding(route)) {
                    NavHost(nav, startDestination = startTab ?: "home") {
                        composable("home") { HomeScreen(nav) }
                        composable("guide") { GuideScreen(nav) }
                        composable("library") { LibraryScreen(nav, null) }
                        composable("films") { LibraryScreen(nav, "movie") }
                        composable("shows") { LibraryScreen(nav, "series") }
                        composable("recordings") { RecordingsScreen(nav) }
                        composable("downloads") { DownloadsScreen(nav) }
                        composable("search") { SearchScreen(nav) }
                        composable("saved") { SavedScreen(nav) }
                        composable("queue") { QueueScreen(nav) }
                        composable("elsewhere") { ElsewhereScreen(nav) }
                        composable("settings") { SettingsScreen(nav) }
                        composable("profiles") { ProfilesScreen(nav) }
                        composable("whatsnew") { WhatsNewScreen(nav) }
                        composable("details/{id}") { e -> DetailsScreen(nav, e.arguments?.getString("id").orEmpty()) }
                        composable("channel/{id}/{name}") { e -> ChannelScreen(nav, e.arguments?.getString("id").orEmpty(), e.arguments?.getString("name").orEmpty()) }
                    }
                }
            }
        }
    }

    // After an update: what's new since this phone last looked (not over Who's watching).
    if (route != "profiles") WhatsNewPopup(nav, ui.online)

    // The app stopped last time: show why, so it can be sent on.
    var crash by remember { mutableStateOf(app.crashFile.takeIf { it.exists() }?.readText()) }
    val clipboard = LocalClipboardManager.current
    crash?.let { text ->
        val close = {
            app.crashFile.delete()
            crash = null
        }
        AlertDialog(
            onDismissRequest = close,
            title = { Text("The app stopped last time") },
            text = { Text(text.take(4000), Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodySmall) },
            confirmButton = { TextButton(onClick = { clipboard.setText(AnnotatedString(text)); close() }) { Text("Copy") } },
            dismissButton = { TextButton(onClick = close) { Text("Close") } },
        )
    }

    ui.ask?.let { a ->
        AlertDialog(
            onDismissRequest = { a.answer.complete(false) },
            title = { Text(a.title) },
            text = { Text(a.message) },
            confirmButton = { TextButton(onClick = { a.answer.complete(true) }) { Text(a.yes) } },
            dismissButton = { TextButton(onClick = { a.answer.complete(false) }) { Text(a.no) } },
        )
    }
    ui.working?.let { w ->
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceVariant, tonalElevation = 6.dp) {
                Row(Modifier.padding(horizontal = 24.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(14.dp))
                    Text(w)
                }
            }
        }
    }
}

@Composable
private fun OfflineBanner(open: () -> Unit) {
    Surface(color = Color(0xFF3A2A08), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = gutter(), vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Away from home: your downloads still play.", Modifier.weight(1f), color = Color(0xFFFFE2A0), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = open) { Text("Downloads") }
        }
    }
}

fun go(nav: NavHostController, route: String) {
    nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

fun details(nav: NavHostController, id: String) = nav.navigate("details/${Hub.enc(id)}")
fun channel(nav: NavHostController, id: String, name: String) = nav.navigate("channel/${Hub.enc(id)}/${Hub.enc(name)}")

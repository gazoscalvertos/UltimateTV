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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.LocalContext
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

private val Colours = darkColorScheme(
    primary = Color(0xFF6EA8FF),
    onPrimary = Color(0xFF041431),
    secondary = Color(0xFFFFC43D),
    background = Color(0xFF070B14),
    surface = Color(0xFF070B14),
    surfaceVariant = Color(0xFF151D2C),
    onSurfaceVariant = Color(0xFFA9B4C8),
    surfaceContainer = Color(0xFF0E1522),
)

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("home", "Home", Icons.Default.Home),
    Tab("guide", "TV Guide", Icons.Default.LiveTv),
    Tab("library", "Films & TV", Icons.Default.Movie),
    Tab("recordings", "Recordings", Icons.Default.VideoLibrary),
    Tab("downloads", "Downloads", Icons.Default.DownloadForOffline),
)

class MainActivity : ComponentActivity() {
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread { notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 15 draws every app edge to edge anyway; doing it on older phones too keeps one layout,
        // with light status bar icons on the dark app. The Scaffold below pads for the bars once.
        enableEdgeToEdge(SystemBarStyle.dark(0xFF070B14.toInt()), SystemBarStyle.dark(0xFF070B14.toInt()))
        val startTab = intent.getStringExtra("tab")
        setContent {
            MaterialTheme(colorScheme = Colours) {
                val snackbar = remember { SnackbarHostState() }
                val scope = rememberCoroutineScope()
                val context = LocalContext.current
                val ui = remember { Ui(context, scope, snackbar, ::askNotifications) }
                CompositionLocalProvider(LocalUi provides ui) {
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
                Offline.syncPositions(app.hub)
                if (app.prefs.profileId == null) nav.navigate("profiles")
            } else if (wasOnline || startTab == null) {
                if (Offline.entries.value.isNotEmpty()) go(nav, "downloads")
            }
        }
    }

    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val wide = isWide()
    val showBars = route != "profiles"

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
        // The status bar, nav bar and (in landscape) the camera cut-out, applied here only once.
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = {
            if (!wide && showBars) {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                    for (t in TABS) NavigationBarItem(
                        selected = route == t.route,
                        onClick = { go(nav, t.route) },
                        icon = { Icon(t.icon, null) },
                        label = { Text(t.label, maxLines = 1) },
                    )
                }
            }
        },
    ) { pad ->
        Row(Modifier.fillMaxSize().padding(pad)) {
            if (wide && showBars) {
                NavigationRail(containerColor = MaterialTheme.colorScheme.surfaceContainer, windowInsets = WindowInsets(0, 0, 0, 0)) {
                    Spacer(Modifier.size(8.dp))
                    for (t in TABS) NavigationRailItem(selected = route == t.route, onClick = { go(nav, t.route) }, icon = { Icon(t.icon, null) }, label = { Text(t.label) })
                    NavigationRailItem(selected = route == "search", onClick = { go(nav, "search") }, icon = { Icon(Icons.Default.Search, null) }, label = { Text("Search") })
                    NavigationRailItem(selected = route == "settings", onClick = { go(nav, "settings") }, icon = { Icon(Icons.Default.Settings, null) }, label = { Text("Settings") })
                }
            }
            Column(Modifier.fillMaxSize()) {
                if (!ui.online && route != "downloads" && route != "settings") OfflineBanner { go(nav, "downloads") }
                Box(Modifier.fillMaxSize()) {
                    NavHost(nav, startDestination = startTab ?: "home") {
                        composable("home") { HomeScreen(nav) }
                        composable("guide") { GuideScreen(nav) }
                        composable("library") { LibraryScreen(nav) }
                        composable("recordings") { RecordingsScreen(nav) }
                        composable("downloads") { DownloadsScreen(nav) }
                        composable("search") { SearchScreen(nav) }
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
        Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
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

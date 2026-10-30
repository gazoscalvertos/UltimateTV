// Search, Settings and choosing who's watching.

package tv.ultimate.client.ui

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.ultimate.client.App
import tv.ultimate.client.BuildConfig
import tv.ultimate.client.Offline
import tv.ultimate.client.PlaybackRequest
import tv.ultimate.client.Profile
import tv.ultimate.client.SearchResult

@Composable
fun SearchScreen(nav: NavHostController) {
    val ui = LocalUi.current
    var q by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(350)
        runCatching { App.instance.hub.search(q.trim()) }.onSuccess { results = it; error = null }.onFailure { error = it }
    }
    Column {
        Header("Search", nav, back = !isWide())
        OutlinedTextField(
            value = q,
            onValueChange = { q = it },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            placeholder = { Text("Channels, programmes, films, shows") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        error?.let { Text(explain(it), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
            items(results) { r ->
                Row(
                    Modifier.fillMaxWidth().clickable {
                        when (r.kind) {
                            "channel", "on-now" -> ui.play(PlaybackRequest("channel", r.channel?.id ?: r.programme?.channelId ?: r.id), name = r.channel?.name ?: r.name)
                            "upcoming" -> open = r.programme?.id ?: r.id
                            "recording" -> ui.play(PlaybackRequest("recording", r.recording?.id ?: r.id), name = r.name)
                            else -> details(nav, r.title?.id ?: r.id)
                        }
                    }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val poster = r.kind == "title"
                    Picture(r.image ?: r.title?.poster ?: r.channel?.logo, Modifier.width(if (poster) 56.dp else 96.dp).aspectRatio(if (poster) 2f / 3f else 16f / 9f).clip(RoundedCornerShape(6.dp)))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(r.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val kind = when (r.kind) {
                            "channel" -> "Channel"
                            "on-now" -> "On now"
                            "upcoming" -> r.programme?.let { "${day(it.start)} ${clock(it.start)}" } ?: "Coming up"
                            "recording" -> "Recording"
                            else -> if (r.title?.kind == "series") "TV show" else "Film"
                        }
                        Text(listOfNotNull(kind, r.subtitle).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    open?.let { id -> ProgrammeSheet(id) { open = null } }
}

@Composable
fun SettingsScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val app = App.instance
    val prefs = app.prefs
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var hubUrl by remember { mutableStateOf(prefs.hub) }
    var wifiOnly by remember { mutableStateOf(prefs.wifiOnly) }
    var smaller by remember { mutableStateOf(prefs.smaller) }
    var paired by remember { mutableStateOf<Boolean?>(null) }
    var pairCode by remember { mutableStateOf("") }
    LaunchedEffect(ui.online) { if (ui.online) paired = runCatching { app.hub.paired() }.getOrNull() }
    fun pairWith(code: String) {
        scope.launch {
            runCatching { app.hub.pair(code, android.os.Build.MODEL ?: "Android phone") }
                .onSuccess { paired = true; pairCode = ""; ui.say("Paired with the TV") }
                .onFailure { ui.say(explain(it)) }
        }
    }
    // The TV's QR code is an address like http://192.168.0.19:8095/remote/?pair=ABCDEFGH: it gives the Hub too.
    fun scanTv() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(context, options).startScan()
            .addOnSuccessListener { code ->
                val uri = Uri.parse(code.rawValue ?: "")
                val pair = runCatching { uri.getQueryParameter("pair") }.getOrNull()
                if (pair == null || uri.scheme?.startsWith("http") != true) {
                    ui.say("That isn't the TV's code. Scan the one in Settings › Phones and remotes.")
                    return@addOnSuccessListener
                }
                prefs.hub = "${uri.scheme}://${uri.authority}"
                hubUrl = prefs.hub
                pairWith(pair)
            }
            .addOnFailureListener { ui.say("The scanner didn't start. Type the code shown on the TV instead.") }
    }
    fun browse(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    Column {
        Header("Settings", nav, back = !isWide())
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Watching as", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(prefs.profileName ?: "No profile chosen", Modifier.weight(1f))
                OutlinedButton(onClick = { nav.navigate("profiles") }, enabled = ui.online) { Text("Change") }
            }
            HorizontalDivider()

            Text("Hub", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            OutlinedTextField(value = hubUrl, onValueChange = { hubUrl = it }, label = { Text("Hub address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    prefs.hub = hubUrl
                    scope.launch {
                        ui.online = app.hub.reachable()
                        ui.say(if (ui.online) "Connected to the Hub" else "Can't reach ${prefs.hub}. The app works on the home Wi-Fi.")
                    }
                }) { Text("Save and test") }
                TextButton(onClick = { hubUrl = tv.ultimate.client.Prefs.DEFAULT_HUB }) { Text("Default") }
            }
            Text("The app streams on the home Wi-Fi. Away from home, your downloads still play.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider()

            Text("Pair with the TV", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Text(
                when (paired) {
                    true -> "Paired: this phone can play things on the TV."
                    false -> "Needed to play things on the TV. On the TV, open Settings › Phones and remotes, then scan the code or type the letters under it."
                    null -> "Checking…"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (paired != true) {
                OutlinedButton(onClick = { scanTv() }, modifier = Modifier.fillMaxWidth()) { Text("Scan the TV's code") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = pairCode, onValueChange = { pairCode = it }, label = { Text("Code on the TV") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { pairWith(pairCode) }, enabled = pairCode.isNotBlank() && ui.online) { Text("Pair") }
                }
            }
            HorizontalDivider()

            Text("Downloads", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Toggle("Only on Wi-Fi", "Films are several gigabytes, so mobile data is off unless you turn this off.", wifiOnly) {
                wifiOnly = it
                prefs.wifiOnly = it
                Offline.applyRequirements()
            }
            Toggle("Smaller copies when possible", "Ask Jellyfin for a 720p copy (about 1.4 GB an hour) instead of the original file.", smaller) {
                smaller = it
                prefs.smaller = it
            }
            Text("${size(Offline.usedBytes()) ?: "Nothing"} saved, ${size(Offline.freeBytes()) ?: "0 MB"} free on this phone", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = {
                scope.launch {
                    if (ui.confirm("Delete every download?", "This frees ${size(Offline.usedBytes()) ?: "the space"} on this phone. Nothing is deleted from the Hub.", "Delete all", "Keep")) {
                        Offline.entries.value.forEach { Offline.remove(it.item.id) }
                    }
                }
            }, enabled = Offline.entries.value.isNotEmpty()) { Text("Delete all downloads") }
            HorizontalDivider()

            Text("More", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            OutlinedButton(onClick = {
                val remote = context.packageManager.getLaunchIntentForPackage("tv.ultimate.remote")
                if (remote != null) context.startActivity(remote) else scope.launch { browse(app.hub.browserUrl("/remote/")) }
            }, modifier = Modifier.fillMaxWidth()) { Text("Phone remote for the TV") }
            OutlinedButton(onClick = { scope.launch { browse(app.hub.browserUrl("/setup/")) } }, modifier = Modifier.fillMaxWidth()) { Text("Hub setup page") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${ui.appName} for Android ${BuildConfig.VERSION_NAME}", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = {
                    scope.launch {
                        runCatching { app.hub.clientVersion() }
                            .onSuccess { v ->
                                if (v.versionCode > BuildConfig.VERSION_CODE) {
                                    if (ui.confirm("Version ${v.versionName ?: v.versionCode} is out", "Download it from the Hub and install it over this one. Your downloads stay.", "Get it", "Later")) browse("${prefs.hub}/api/client/app.apk")
                                } else {
                                    ui.say("This is the latest version")
                                }
                            }
                            .onFailure { ui.say(explain(it)) }
                    }
                }) { Text("Check for updates") }
            }
        }
    }
}

@Composable
private fun Toggle(title: String, detail: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { change(!value) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = value, onCheckedChange = change)
    }
}

@Composable
fun ProfilesScreen(nav: NavHostController) {
    val ui = LocalUi.current
    val app = App.instance
    val scope = rememberCoroutineScope()
    val list = rememberLoad { app.hub.profiles() }
    var pinFor by remember { mutableStateOf<Profile?>(null) }
    fun choose(p: Profile, pin: String?) {
        scope.launch {
            runCatching { app.hub.unlock(p.id, pin) }
                .onSuccess { token ->
                    app.prefs.profileId = p.id
                    app.prefs.profileToken = token
                    app.prefs.profileName = p.name
                    app.prefs.profileKind = p.kind
                    pinFor = null
                    go(nav, "home")
                }
                .onFailure { ui.say(explain(it)) }
        }
    }
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(48.dp))
        Text("Who's watching?", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(32.dp))
        Loaded(list) { ps ->
            val locked = ps.locked == true
            LazyVerticalGrid(GridCells.Adaptive(120.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                items(ps.profiles.orEmpty()) { p ->
                    val needsPin = p.hasPin == true || (locked && p.kind == "adult")
                    Column(Modifier.clickable { if (needsPin) pinFor = p else choose(p, null) }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(88.dp).clip(CircleShape).background(colourOf(p.colour)), contentAlignment = Alignment.Center) {
                            Text(p.name.take(1).uppercase(), fontSize = 36.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(p.name)
                            if (needsPin) Icon(Icons.Default.Lock, "PIN", Modifier.padding(start = 4.dp).size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (p.kind == "kids") Text("Kids", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    pinFor?.let { p ->
        var pin by remember(p.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pinFor = null },
            title = { Text("PIN for ${p.name}") },
            text = {
                OutlinedTextField(
                    value = pin,
                    onValueChange = { v -> pin = v.filter { it.isDigit() }.take(8) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            },
            confirmButton = { TextButton(onClick = { choose(p, pin) }, enabled = pin.isNotEmpty()) { Text("OK") } },
            dismissButton = { TextButton(onClick = { pinFor = null }) { Text("Cancel") } },
        )
    }
}

private fun colourOf(hex: String?): Color = runCatching { Color(android.graphics.Color.parseColor(hex ?: "#3B6FD8")) }.getOrDefault(Color(0xFF3B6FD8))

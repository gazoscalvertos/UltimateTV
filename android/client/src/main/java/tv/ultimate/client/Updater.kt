// Updating the app from inside the app. A Fire stick has no browser, so "Check for updates" can't
// just open the download link: the app fetches the APK from the Hub itself and hands it to
// Android's installer. Android asks once for permission to install from this app ("Install unknown
// apps"); after that an update is: Update now, wait, press Install on the system screen.

package tv.ultimate.client

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object Updater {
    /** Returns the newer version the Hub offers, or null when this is the latest. */
    suspend fun newer(hub: Hub): AppVersion? =
        hub.clientVersion().takeIf { it.versionCode > BuildConfig.VERSION_CODE }

    /** True when a version this old can't be installed over (signed with the old key, #93). */
    fun needsFreshInstall(v: AppVersion): Boolean = BuildConfig.VERSION_CODE < (v.uninstallBelow ?: 0)

    fun mayInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Opens Android's "Install unknown apps" switch for this app (Back returns here). */
    fun askPermission(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /** Downloads the APK, reporting 0..1 (or -1 when the size isn't known), and returns the file. */
    suspend fun download(context: Context, hubBase: String, progress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "update.apk")
        val c = URL(hubBase + BuildConfig.UPDATE_PATH).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 60_000
        try {
            if (c.responseCode != 200) error("The Hub couldn't supply the update (${c.responseCode}). Try again in a minute.")
            val total = c.contentLengthLong
            var done = 0L
            c.inputStream.use { input ->
                out.outputStream().use { o ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        done += n
                        progress(if (total > 0) done.toFloat() / total else -1f)
                    }
                }
            }
            if (out.length() < 1_000_000) error("The download looks incomplete. Try again.")
            out
        } finally {
            c.disconnect()
        }
    }

    /** Hands the downloaded APK to the system installer. */
    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

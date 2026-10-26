package tv.ultimate.client

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Scheduler
import tv.ultimate.client.ui.MainActivity

/** Keeps downloads going with the app closed, with a progress notification. */
class DownloadsService : DownloadService(1, DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL, Offline.CHANNEL, R.string.downloads_channel, 0) {
    override fun getDownloadManager(): DownloadManager {
        Offline.init(this, App.instance.prefs)
        return Offline.manager
    }

    override fun getScheduler(): Scheduler = PlatformScheduler(this, 7)

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).putExtra("tab", "downloads"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Offline.notifications.buildProgressNotification(this, android.R.drawable.stat_sys_download, open, null, downloads, notMetRequirements)
    }
}

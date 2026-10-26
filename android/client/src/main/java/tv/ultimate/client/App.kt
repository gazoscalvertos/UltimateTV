package tv.ultimate.client

import android.app.Application

class App : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var hub: Hub
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Keep what went wrong, so the next start can show it (the app has no other log you can see).
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching { crashFile.writeText("${java.util.Date()}\n${android.util.Log.getStackTraceString(e)}") }
            previous?.uncaughtException(thread, e)
        }
        prefs = Prefs(this)
        hub = Hub(prefs)
        Offline.init(this, prefs)
    }

    val crashFile get() = java.io.File(filesDir, "last-crash.txt")

    companion object {
        lateinit var instance: App
            private set
    }
}

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
        prefs = Prefs(this)
        hub = Hub(prefs)
        Offline.init(this, prefs)
    }

    companion object {
        lateinit var instance: App
            private set
    }
}

// The preview picture above the seek bar while scrubbing (#227). Jellyfin's trickplay sheets hold a
// frame every few seconds; this fetches a sheet once, keeps it as a region decoder (so only the one
// small frame is ever turned into a bitmap, which matters on a Fire TV stick) and shows the frame for
// where the scrub has got to. No frames described, or a sheet that won't load: nothing is shown.

package tv.ultimate.client

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Color
import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.media3.ui.DefaultTimeBar
import androidx.media3.ui.TimeBar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL

/** Jellyfin's contact sheets: `url` has {n} where the sheet number goes. Mirrors shared `Trickplay`. */
data class Trickplay(
    val url: String,
    val intervalMs: Long,
    val width: Int,
    val height: Int,
    val tileWidth: Int,
    val tileHeight: Int,
    val count: Int,
)

/** Which sheet and where on it holds the frame for [ms]; null when the description can't be used. */
data class TrickplayFrame(val url: String, val x: Int, val y: Int)

fun trickplayFrame(tp: Trickplay, ms: Long): TrickplayFrame? {
    if (tp.intervalMs <= 0 || tp.tileWidth < 1 || tp.tileHeight < 1 || tp.count < 1) return null
    val frame = (ms / tp.intervalMs).coerceIn(0L, (tp.count - 1).toLong()).toInt()
    val perSheet = tp.tileWidth * tp.tileHeight
    val within = frame % perSheet
    return TrickplayFrame(tp.url.replace("{n}", (frame / perSheet).toString()), (within % tp.tileWidth) * tp.width, (within / tp.tileWidth) * tp.height)
}

class SeekPreview(private val root: FrameLayout, private val scope: CoroutineScope, private val duration: () -> Long) {
    private val image = ImageView(root.context).apply {
        visibility = View.GONE
        scaleType = ImageView.ScaleType.FIT_XY
        setBackgroundColor(Color.BLACK)
        setPadding(2, 2, 2, 2)
    }
    private var tp: Trickplay? = null
    private var attached: DefaultTimeBar? = null
    private val sheets = LinkedHashMap<String, BitmapRegionDecoder>()
    private val failed = HashSet<String>()
    private var job: Job? = null
    private var shown: Bitmap? = null

    init {
        root.addView(image, FrameLayout.LayoutParams(0, 0, Gravity.BOTTOM or Gravity.START))
    }

    /** What the item now playing has, or null for none. Anything fetched for the last item is dropped. */
    fun set(next: Trickplay?) {
        tp = next
        hide()
        synchronized(sheets) {
            sheets.values.forEach { it.recycle() }
            sheets.clear()
            failed.clear()
        }
    }

    /** Listen to the player's own seek bar (the touch drag and the remote's held left and right). */
    fun attach(timeBar: DefaultTimeBar?) {
        if (timeBar == null || attached === timeBar) return
        attached = timeBar
        timeBar.addListener(object : TimeBar.OnScrubListener {
            override fun onScrubStart(timeBar: TimeBar, position: Long) = show(timeBar, position)
            override fun onScrubMove(timeBar: TimeBar, position: Long) = show(timeBar, position)
            override fun onScrubStop(timeBar: TimeBar, position: Long, canceled: Boolean) = hide()
        })
    }

    private fun show(bar: TimeBar, position: Long) {
        val t = tp ?: return
        val frame = trickplayFrame(t, position) ?: return
        job?.cancel()
        job = scope.launch {
            val bitmap = withContext(Dispatchers.IO) { cut(t, frame) } ?: return@launch
            // The scrub may have ended while the sheet was loading.
            if (job?.isCancelled == true) return@launch
            val scale = root.resources.displayMetrics.density * 0.6f
            val w = (t.width * scale).toInt().coerceAtLeast(1)
            val h = (t.height * scale).toInt().coerceAtLeast(1)
            val barView = bar as View
            val at = IntArray(2)
            barView.getLocationInWindow(at)
            val rootAt = IntArray(2)
            root.getLocationInWindow(rootAt)
            val total = duration()
            val frac = if (total > 0) (position.toFloat() / total).coerceIn(0f, 1f) else 0f
            val centre = at[0] - rootAt[0] + barView.paddingLeft + frac * (barView.width - barView.paddingLeft - barView.paddingRight)
            val left = (centre - w / 2f).toInt().coerceIn(0, (root.width - w).coerceAtLeast(0))
            val bottom = root.height - (at[1] - rootAt[1]) + 8
            (image.layoutParams as FrameLayout.LayoutParams).apply {
                width = w + 4
                height = h + 4
                leftMargin = left
                bottomMargin = bottom
            }
            image.requestLayout()
            image.setImageBitmap(bitmap)
            shown?.recycle()
            shown = bitmap
            image.visibility = View.VISIBLE
        }
    }

    fun hide() {
        job?.cancel()
        image.visibility = View.GONE
    }

    /** Download one sheet and keep it; null (and not tried again) when it can't be had. */
    private fun fetch(url: String): BitmapRegionDecoder? {
        val made: BitmapRegionDecoder? = try {
            val bytes = URL(url).openConnection().apply { connectTimeout = 5_000; readTimeout = 10_000 }.getInputStream().use { it.readBytes() }
            @Suppress("DEPRECATION")
            BitmapRegionDecoder.newInstance(bytes, 0, bytes.size, false)
        } catch (_: Exception) {
            null
        }
        synchronized(sheets) {
            if (made == null) {
                failed.add(url)
            } else {
                // Four sheets at most (each is a few hundred KB of JPEG): the ones scrubbed over lately.
                while (sheets.size >= 4) sheets.keys.first().let { sheets.remove(it)?.recycle() }
                sheets[url] = made
            }
        }
        return made
    }

    /** One frame as a bitmap, fetching the sheet if it isn't here yet. Runs off the main thread. */
    private fun cut(t: Trickplay, frame: TrickplayFrame): Bitmap? {
        val cached = synchronized(sheets) { if (frame.url in failed) return null else sheets[frame.url] }
        val decoder: BitmapRegionDecoder = cached ?: fetch(frame.url) ?: return null
        return try {
            val rect = Rect(frame.x, frame.y, (frame.x + t.width).coerceAtMost(decoder.width), (frame.y + t.height).coerceAtMost(decoder.height))
            if (rect.isEmpty) null else decoder.decodeRegion(rect, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 })
        } catch (_: Exception) {
            null
        }
    }
}

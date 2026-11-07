// What this device can actually show and decode, so the Hub can choose a stream that will play.
//
// A Fire TV stick that is 1080p only (the Fire TV Stick Lite and the non-4K sticks) is handed the
// same 4K remux a 4K TV would get unless it says otherwise: the file then either fails to decode,
// plays through a software decoder, or direct-plays 60 GB over Wi-Fi and spends a minute filling
// its buffer. This works out three limits from the hardware and sends them with every request
// (X-Max-Height, X-Max-Bitrate, X-Codecs), so the Hub picks a version that fits (hub/src/streamcaps.ts).

package tv.ultimate.client

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import tv.ultimate.client.ui.isTvUi

data class DeviceCaps(
    /** Tallest picture worth asking for, in pixels (1080 for a 1080p TV or decoder). */
    val maxHeight: Int,
    /** Highest video bitrate the link and decoder are good for, in kbit/s. */
    val maxBitrateKbps: Int,
    /** Video codecs a hardware decoder here handles at [maxHeight], e.g. "h264,hevc". */
    val codecs: List<String>,
    /** One line for Settings: where the numbers came from. */
    val summary: String,
)

object DeviceProfile {
    /** Settings › Picture limit. "auto" trusts [detect]. */
    val HEIGHT_CHOICES = listOf("auto", "2160", "1080", "720")
    val BITRATE_CHOICES = listOf("auto", "60", "30", "15", "8")

    private var detected: DeviceCaps? = null

    /** An Amazon Fire TV or Fire stick: the preset below is for these. */
    fun isFireTv(context: Context): Boolean =
        Build.MANUFACTURER.equals("Amazon", ignoreCase = true) && (isTvUi(context) || Build.MODEL.startsWith("AFT"))

    /** The limits to send: the hardware's, then the household's override from Settings. */
    fun current(context: Context, prefs: Prefs): DeviceCaps {
        val base = detected ?: detect(context).also { detected = it }
        val h = prefs.pictureLimit.toIntOrNull() ?: base.maxHeight
        val b = prefs.bitrateLimit.toIntOrNull()?.times(1000) ?: base.maxBitrateKbps
        return base.copy(maxHeight = h, maxBitrateKbps = b)
    }

    fun detect(context: Context): DeviceCaps {
        val display = (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
        // The mode the TV is really running (a 1080p-only stick reports 1920x1080 here whatever the
        // panel behind it can do), not the panel's best.
        val mode = display?.mode
        val displayHeight = mode?.physicalHeight ?: 1080
        val shown = if (displayHeight >= 2000) 2160 else if (displayHeight >= 1000) 1080 else 720

        // A hardware decoder for each codec, and the tallest picture it takes.
        val decoded = mutableMapOf<String, Int>()
        val infos = runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos }.getOrDefault(emptyArray())
        for ((name, mime) in listOf("h264" to "video/avc", "hevc" to "video/hevc", "av1" to "video/av01", "vp9" to "video/x-vnd.on2.vp9")) {
            var best = 0
            for (info in infos) {
                if (info.isEncoder || !info.supportedTypes.any { it.equals(mime, true) } || isSoftware(info)) continue
                val v = runCatching { info.getCapabilitiesForType(mime).videoCapabilities }.getOrNull() ?: continue
                best = maxOf(best, when {
                    v.isSizeSupported(3840, 2160) -> 2160
                    v.isSizeSupported(1920, 1080) -> 1080
                    v.isSizeSupported(1280, 720) -> 720
                    else -> 0
                })
            }
            if (best > 0) decoded[name] = best
        }
        val decodeHeight = maxOf(decoded["hevc"] ?: 0, decoded["h264"] ?: 0).takeIf { it > 0 } ?: 1080
        val height = minOf(shown, decodeHeight)
        // Codecs worth sending: only those a hardware decoder takes at the height we cap to.
        val codecs = decoded.filterValues { it >= minOf(height, 1080) }.keys.toList()
        var bitrate = if (height >= 2160) 60_000 else 30_000
        var summary = "Screen ${shown}p, decoder ${decodeHeight}p"
        if (isFireTv(context)) {
            // Fire TV preset. A stick's CPU, memory and Wi-Fi are weak: even a stick that decodes 4K
            // is happiest at 1080p, and one that can't must never be offered a 4K remux. 4K sticks
            // keep 4K only when both the screen and the decoder say so.
            bitrate = if (height < 2160) 20_000 else 40_000
            summary = "Fire TV · $summary"
        }
        return DeviceCaps(height, bitrate, codecs.ifEmpty { listOf("h264") }, summary)
    }

    private fun isSoftware(info: MediaCodecInfo): Boolean =
        if (Build.VERSION.SDK_INT >= 29) info.isSoftwareOnly
        else info.name.startsWith("OMX.google.") || info.name.startsWith("c2.android.") || info.name.endsWith(".sw.dec")
}

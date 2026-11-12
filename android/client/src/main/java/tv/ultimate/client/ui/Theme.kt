// The look of the app. It wears the same theme as the TV (Dark, Ocean, Halloween, …): the Hub
// sends the palette of today's theme (GET /api/theme) and every screen paints with it, so the Fire
// TV, the phone and the TV in the lounge look like one app. See docs/themes.md and docs/android-client.md.

package tv.ultimate.client.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.google.gson.Gson
import tv.ultimate.client.ThemeInfo

/** One theme's palette: the names are the TV's CSS custom properties (shared/src/themes.ts). */
@Immutable
class Utv(
    val id: String,
    val light: Boolean,
    val bg: Color,
    val bg2: Color,
    val panel: Color,
    val panel2: Color,
    val line: Color,
    val fg: Color,
    val fg2: Color,
    val muted: Color,
    val dim: Color,
    val accent: Color,
    val accent2: Color,
    val onAccent: Color,
    val good: Color,
    val bad: Color,
    val amber: Color,
    /** The ring round a focused card. */
    val focus: Color,
    /** A focused button or tab is filled with this, its text in [onSel]. */
    val sel: Color,
    val onSel: Color,
    val onSelMuted: Color,
    /** What translucent surfaces are lifted with: white on dark themes. */
    val hi: Color,
    /** The soft glow at the top of every screen. */
    val glow: Color,
) {
    /** The theme's lifting colour at [alpha]: the TV's `rgb(var(--hi) / alpha)`. */
    fun lift(alpha: Float): Color = hi.copy(alpha = alpha)

    /** The same colours for Material's own widgets (switches, dialogs, text fields, …). */
    fun scheme(): ColorScheme {
        val chip = accent.copy(alpha = 0.22f).compositeOver(bg)
        return if (light) {
            lightColorScheme(
                primary = accent, onPrimary = onAccent, secondary = amber, onSecondary = Color.Black,
                background = bg, onBackground = fg, surface = bg, onSurface = fg,
                surfaceVariant = panel2, onSurfaceVariant = muted, surfaceContainer = panel,
                surfaceContainerHigh = panel, surfaceContainerHighest = panel2, surfaceContainerLow = panel,
                secondaryContainer = chip, onSecondaryContainer = fg, outline = dim, outlineVariant = line, error = bad,
            )
        } else {
            darkColorScheme(
                primary = accent, onPrimary = onAccent, secondary = amber, onSecondary = Color.Black,
                background = bg, onBackground = fg, surface = bg, onSurface = fg,
                surfaceVariant = panel2, onSurfaceVariant = muted, surfaceContainer = panel,
                surfaceContainerHigh = panel, surfaceContainerHighest = panel2, surfaceContainerLow = panel,
                secondaryContainer = chip, onSecondaryContainer = fg, outline = dim, outlineVariant = line, error = bad,
            )
        }
    }

    companion object {
        /** A CSS colour from the palette: `#rrggbb`, `rgba(r, g, b, a)` or the bare `r g b` of `--hi`. */
        fun css(value: String?, fallback: Color): Color {
            val s = value?.trim().orEmpty()
            if (s.isEmpty()) return fallback
            return try {
                when {
                    s.startsWith("#") -> {
                        val h = s.substring(1)
                        val full = if (h.length == 3) h.map { "$it$it" }.joinToString("") else h
                        if (full.length == 6) Color((0xFF000000L or full.toLong(16)).toInt()) else fallback
                    }
                    else -> {
                        val n = s.substringAfter('(').substringBefore(')').split(',', ' ', '/')
                            .map { it.trim() }.filter { it.isNotEmpty() }.map { it.toFloat() }
                        if (n.size >= 3) Color(n[0] / 255f, n[1] / 255f, n[2] / 255f, if (n.size > 3) n[3] else 1f) else fallback
                    }
                }
            } catch (e: Exception) {
                fallback
            }
        }

        /** The palette the Hub sent, with the TV's Dark theme filling in anything missing. */
        fun of(info: ThemeInfo?): Utv {
            val p = info?.palette.orEmpty()
            fun c(key: String, fallback: Color) = css(p[key], fallback)
            return Utv(
                id = info?.id ?: "default",
                light = info?.light ?: false,
                bg = c("--bg", Color(0xFF070B14)),
                bg2 = c("--bg-2", Color(0xFF0D1424)),
                panel = c("--panel", Color(0xFF121B2E)),
                panel2 = c("--panel-2", Color(0xFF18233A)),
                line = c("--line", Color(0x1AFFFFFF)),
                fg = c("--fg", Color(0xFFF3F6FB)),
                fg2 = c("--fg-2", Color(0xFFD5DBE7)),
                muted = c("--muted", Color(0xFF9AA6BD)),
                dim = c("--dim", Color(0xFF66728A)),
                accent = c("--accent", Color(0xFF3D8BFF)),
                accent2 = c("--accent-2", Color(0xFF00C2D1)),
                onAccent = c("--on-accent", Color.White),
                good = c("--good", Color(0xFF35C27A)),
                bad = c("--bad", Color(0xFFFF5468)),
                amber = c("--amber", Color(0xFFF2B33D)),
                focus = c("--focus", Color.White),
                sel = c("--sel", Color(0xFFF3F6FB)),
                onSel = c("--on-sel", Color(0xFF0A0F1A)),
                onSelMuted = c("--on-sel-muted", Color(0xFF48526A)),
                hi = c("--hi", Color.White),
                glow = c("--glow", Color(0xFF14264A)),
            )
        }

        /** What was saved last time (Prefs.themeJson), so the right colours show before the Hub answers. */
        fun saved(json: String?): Utv = of(runCatching { Gson().fromJson(json, ThemeInfo::class.java) }.getOrNull())
    }
}

val LocalUtv = compositionLocalOf { Utv.of(null) }

/** The space down each side of a screen: the TV's overscan-safe 6rem, less on a tablet or phone. */
val LocalGutter = compositionLocalOf { 16.dp }

@Composable
fun gutter(): Dp = LocalGutter.current

/** Material's type scale, smaller: sizes made for a phone read too big across a room once the TV is scaled up. */
fun Typography.scaled(f: Float): Typography {
    fun TextStyle.sc(): TextStyle = copy(
        fontSize = if (fontSize != TextUnit.Unspecified) fontSize * f else fontSize,
        lineHeight = if (lineHeight != TextUnit.Unspecified) lineHeight * f else lineHeight,
    )
    return copy(
        displayLarge = displayLarge.sc(), displayMedium = displayMedium.sc(), displaySmall = displaySmall.sc(),
        headlineLarge = headlineLarge.sc(), headlineMedium = headlineMedium.sc(), headlineSmall = headlineSmall.sc(),
        titleLarge = titleLarge.sc(), titleMedium = titleMedium.sc(), titleSmall = titleSmall.sc(),
        bodyLarge = bodyLarge.sc(), bodyMedium = bodyMedium.sc(), bodySmall = bodySmall.sc(),
        labelLarge = labelLarge.sc(), labelMedium = labelMedium.sc(), labelSmall = labelSmall.sc(),
    )
}

/** Thin wrapper so Theme.kt reads one Gson. */
internal fun themeJson(info: ThemeInfo): String = Gson().toJson(info)

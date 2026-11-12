// Focus on a TV. A remote only sends direction keys, so something has to be focused as soon as a
// screen appears, or the arrow keys do nothing and the app looks frozen. Compose moves focus by
// itself once a key arrives, but only if one of the items is already reachable, so on a TV we put
// focus on the screen as it opens.

package tv.ultimate.client.ui

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext

/** True on a Fire TV or any other television: there is no touchscreen, only a remote. */
fun isTvUi(context: Context): Boolean {
    val pm = context.packageManager
    return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
        pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION) ||
        pm.hasSystemFeature("android.hardware.type.television")
}

/**
 * Puts focus on this element when it appears, on a TV only; on a phone it does nothing.
 *
 * [key] identifies the screen. When it changes the old screen has been replaced, so focus is
 * asked for again on the new one. The element should be a focus group (a Column or Box holding
 * the screen's buttons) so the request lands on its first focusable child.
 */
@Composable
fun Modifier.tvLanding(key: Any? = Unit): Modifier {
    val context = LocalContext.current
    if (!isTvUi(context)) return this
    val requester = remember(key) { FocusRequester() }
    LaunchedEffect(key) {
        // Wait one frame: the items inside have to be laid out before one can take focus.
        withFrameNanos { }
        runCatching { requester.requestFocus() }
    }
    // A focus group hands the request on to its first focusable child, which is what a remote
    // needs: one clear starting place, then the arrow keys walk from there.
    return this.focusRequester(requester).focusGroup()
}

/** Cached per composition: true on a Fire TV or any other television. */
@Composable
fun rememberIsTv(): Boolean {
    val context = LocalContext.current
    return remember(context) { isTvUi(context) }
}

/**
 * A clickable that a remote can see. Compose's plain `clickable` is focusable but draws almost
 * nothing when it has focus, so with a D-pad you cannot tell where you are. On a TV this adds a
 * white ring, a slight lift and a tint to the focused item; on a phone it is just `clickable`.
 */
@Composable
fun Modifier.tvClickable(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    if (!rememberIsTv()) return this.clickable(enabled = enabled, onClick = onClick)
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, label = "tvFocusScale")
    val shape = RoundedCornerShape(8.dp)
    val c = LocalUtv.current
    return this
        .onFocusChanged { focused = it.isFocused }
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .then(if (focused) Modifier.background(c.lift(0.14f), shape).border(2.5.dp, c.focus, shape) else Modifier)
        .clickable(enabled = enabled, onClick = onClick)
}

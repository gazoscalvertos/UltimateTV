// Focus on a TV. A remote only sends direction keys, so something has to be focused as soon as a
// screen appears, or the arrow keys do nothing and the app looks frozen. Compose moves focus by
// itself once a key arrives, but only if one of the items is already reachable, so on a TV we put
// focus on the screen as it opens.

package tv.ultimate.client.ui

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.foundation.focusGroup
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

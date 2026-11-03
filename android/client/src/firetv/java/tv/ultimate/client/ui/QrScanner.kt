// The Fire TV build's camera scanner: there isn't one. A Fire stick has no camera, and Fire OS has
// no Google Play services to scan with — including the library at all would crash the app on
// launch, before this file could be reached (#183). Settings shows the typed code instead.

package tv.ultimate.client.ui

import android.content.Context

/** Whether Settings should offer to scan the TV's code. Not here: Fire TV has no camera. */
internal fun canScanQr(): Boolean = false

/** Never called (see [canScanQr]); [onProblem] says what to do instead. */
internal fun scanQr(context: Context, onCode: (String) -> Unit, onProblem: (String) -> Unit) {
    onProblem("This device has no camera. Type the code shown on the TV instead.")
}

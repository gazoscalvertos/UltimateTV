// Reading the TV's pairing code with the phone's own camera (#198).
//
// This used to be Google Play services' barcode scanner, which only works on a phone with Play
// services and pushed a pile of Google libraries into the app. The camera work now lives in the
// :scanner module (CameraX + ZXing), which every device can use — including one with no Google
// apps at all, and the Fire TV build, which simply reports that it has no camera.

package tv.ultimate.client.ui

import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import tv.ultimate.scanner.QrScanner

/**
 * A button that opens the camera and hands back the text in the TV's code.
 *
 * Returns null when this device has no camera — a Fire stick, or a tablet without one — so the
 * caller can leave the button out and offer the typed code instead.
 */
@Composable
internal fun rememberQrScanner(onCode: (String) -> Unit, onProblem: (String) -> Unit): (() -> Unit)? {
    val context = LocalContext.current
    val canScan = remember(context) {
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }
    if (!canScan) return null
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val problem = QrScanner.problem(result.data, result.resultCode == android.app.Activity.RESULT_CANCELED)
        val text = if (problem == null) QrScanner.text(result.data) else null
        if (text != null) onCode(text) else if (problem != null) onProblem(problem)
    }
    return remember(launcher, context) { { launcher.launch(QrScanner.intent(context)) } }
}

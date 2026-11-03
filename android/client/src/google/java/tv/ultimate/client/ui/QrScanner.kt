// The phone build's camera scanner: Google Play services' barcode scanner, which needs no camera
// permission of its own. Only in the "google" flavour — see build.gradle for why (#183).

package tv.ultimate.client.ui

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** Whether Settings should offer to scan the TV's code. */
internal fun canScanQr(): Boolean = true

/**
 * Opens the camera scanner and hands back what it read. A device without a camera (a tablet with
 * none, a phone whose camera app is denied) gets [onProblem] instead.
 */
internal fun scanQr(context: Context, onCode: (String) -> Unit, onProblem: (String) -> Unit) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { code -> onCode(code.rawValue ?: "") }
        .addOnFailureListener { onProblem("The scanner didn't start. Type the code shown on the TV instead.") }
}

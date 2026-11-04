package tv.ultimate.scanner;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

/**
 * Reads the TV's pairing QR code with the camera, without Google Play services.
 *
 * <p>Call {@link #scan(Activity, int)} and deal with the answer in
 * {@code onActivityResult}. The code is an address like
 * {@code http://192.168.0.19:8095/remote/?pair=ABCDEFGH}: it carries both the Hub's address and
 * the pairing code.
 *
 * <p>There is no camera on a Fire TV stick and no camera permission on a TV. {@link #canScan}
 * says so, so a caller can offer the typed code instead of a button that cannot work.
 */
public final class QrScanner {

    /** What an activity passes back: the text in the code, or why it was not read. */
    public static final String EXTRA_TEXT = "tv.ultimate.scanner.TEXT";
    public static final String EXTRA_PROBLEM = "tv.ultimate.scanner.PROBLEM";

    private QrScanner() {
    }

    /** Whether this device can open a camera at all. */
    public static boolean canScan(Context context) {
        return context.getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY);
    }

    /** Opens the camera. The answer comes back through {@code onActivityResult}. */
    public static void scan(Activity activity, int requestCode) {
        activity.startActivityForResult(intent(activity), requestCode);
    }

    /** The same thing as an Intent, for callers that launch with a result contract (Compose). */
    public static Intent intent(Context context) {
        return new Intent(context, QrScanActivity.class);
    }

    /**
     * The text the scanner read, from an {@code onActivityResult} that belongs to the scanner.
     * Null when the scan was cancelled or failed — {@link #problem} then says why.
     */
    public static String text(Intent data) {
        return data == null ? null : data.getStringExtra(EXTRA_TEXT);
    }

    /** Why there is no text: cancelled, permission refused, or the camera wouldn't start. */
    public static String problem(Intent data, boolean cancelled) {
        if (cancelled) return null;
        String problem = data == null ? null : data.getStringExtra(EXTRA_PROBLEM);
        return problem != null ? problem : "The camera didn't read a code. Type the code shown on the TV instead.";
    }
}

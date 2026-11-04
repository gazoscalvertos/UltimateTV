package tv.ultimate.scanner;

import android.graphics.ImageFormat;
import android.media.Image;
import android.util.Log;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.GlobalHistogramBinarizer;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Turns a camera frame into QR text with ZXing. Split out from the activity so it can be tested
 * with no camera (see scanner/test): the activity does the camera, this does the thinking.
 *
 * <p>CameraX hands over YUV_420_888 planes, of which the luminance plane is enough — a barcode is
 * black and white, so the chroma planes add nothing.
 */
final class QrDecode {

    private static final String TAG = "UltimateTVScan";
    private final MultiFormatReader reader = new MultiFormatReader();

    QrDecode() {
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        List<BarcodeFormat> formats = new ArrayList<>();
        formats.add(BarcodeFormat.QR_CODE);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, formats);
        // A TV's code is short and flat-on, so only the plain path is needed; trying harder
        // would only spend time on frames that have no code in them.
        hints.put(DecodeHintType.TRY_HARDER, Boolean.FALSE);
        reader.setHints(hints);
    }

    /**
     * The text in this frame, or null when there is no readable code in it. Frames without a code
     * are the normal case — the camera runs at 30 a second — so this is deliberately silent.
     */
    String read(Image image) {
        if (image == null) return null;
        if (image.getFormat() != ImageFormat.YUV_420_888) return null;
        try {
            return read(image.getWidth(), image.getHeight(), image.getPlanes()[0].getBuffer(),
                    image.getPlanes()[0].getRowStride(), image.getPlanes()[0].getPixelStride());
        } catch (RuntimeException e) {
            // A frame can be closed under us when the camera stops; one dropped frame is not a failure.
            Log.d(TAG, "frame skipped: " + e);
            return null;
        }
    }

    /** The luminance plane as a ZXing source. Package-visible so the tests can call it directly. */
    String read(int width, int height, ByteBuffer luminance, int rowStride, int pixelStride) {
        if (width <= 0 || height <= 0) return null;
        byte[] y = toDenseLuminance(width, height, luminance, rowStride, pixelStride);
        PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(y, width, height, 0, 0, width, height, false);
        try {
            Result result = reader.decodeWithState(new BinaryBitmap(new GlobalHistogramBinarizer(source)));
            return result == null ? null : result.getText();
        } catch (NotFoundException e) {
            return null;
        } finally {
            reader.reset();
        }
    }

    /**
     * Copy the luminance plane into a tight array. Some devices pad every row (rowStride above the
     * width) and some interleave in a way that leaves gaps between pixels, so neither can be used
     * where it lies.
     */
    static byte[] toDenseLuminance(int width, int height, ByteBuffer buffer, int rowStride, int pixelStride) {
        byte[] out = new byte[width * height];
        if (buffer == null) return out;
        ByteBuffer plane = buffer.duplicate();
        plane.rewind();
        for (int y = 0; y < height; y++) {
            int row = y * rowStride;
            for (int x = 0; x < width; x++) {
                int index = row + x * pixelStride;
                if (index >= plane.limit()) return out;
                out[y * width + x] = plane.get(index);
            }
        }
        return out;
    }
}

package tv.ultimate.scanner;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import org.junit.Test;

import java.nio.ByteBuffer;
import java.util.EnumMap;
import java.util.Map;

/**
 * The decoder, without a camera.
 *
 * <p>ZXing is plain Java and the point where this module does its thinking is a ByteBuffer full of
 * luminance, so a real QR code can be drawn here, turned into a camera-shaped frame, and read back
 * on the build machine. That is worth doing: a scanner that cannot decode the code it is pointed at
 * looks exactly like a scanner that works until someone tries it on a phone.
 */
public class QrDecodeTest {

    /** What the TV's pairing code actually says. */
    private static final String PAIRING = "http://192.168.0.19:8095/remote/?pair=ABCDEFGH";

    /** A QR code drawn as luminance, one byte per pixel, black = 0 and white = 255. */
    private static byte[] code(String text, int size) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, 2);
        BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
        byte[] pixels = new byte[size * size];
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                pixels[y * size + x] = (byte) (matrix.get(x, y) ? 0 : 255);
            }
        }
        return pixels;
    }

    private static String read(byte[] pixels, int width, int height) {
        return new QrDecode().read(width, height, ByteBuffer.wrap(pixels), width, 1);
    }

    @Test
    public void readsTheTvsPairingCode() throws Exception {
        assertEquals(PAIRING, read(code(PAIRING, 240), 240, 240));
    }

    @Test
    public void readsItWhenTheRowsArePaddedLikeACameraFrame() throws Exception {
        // Cameras pad every row: a 200-pixel-wide image can arrive with a row stride of 256.
        int width = 200;
        int height = 200;
        int stride = 256;
        byte[] tight = code(PAIRING, width);
        byte[] padded = new byte[stride * height];
        for (int y = 0; y < height; y++) {
            System.arraycopy(tight, y * width, padded, y * stride, width);
        }
        assertEquals(PAIRING, new QrDecode().read(width, height, ByteBuffer.wrap(padded), stride, 1));
    }

    @Test
    public void readsItWhenEveryPixelTakesTwoBytesLikeAYuvPlane() throws Exception {
        // A YUV_420_888 luminance plane can arrive with a pixel stride of 2 (NV12-style layouts
        // share the plane with the chroma), so the pixels to read are every other byte.
        int width = 180;
        int height = 180;
        byte[] tight = code(PAIRING, width);
        int stride = width * 2;
        byte[] spread = new byte[stride * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                spread[y * stride + x * 2] = tight[y * width + x];
            }
        }
        assertEquals(PAIRING, new QrDecode().read(width, height, ByteBuffer.wrap(spread), stride, 2));
    }

    @Test
    public void saysNothingAboutAFrameWithNoCodeInIt() throws Exception {
        byte[] blank = new byte[240 * 240];
        java.util.Arrays.fill(blank, (byte) 255);
        assertNull(read(blank, 240, 240));
    }

    @Test
    public void saysNothingAboutRubbish() throws Exception {
        byte[] noise = new byte[240 * 240];
        java.util.Random random = new java.util.Random(7);
        random.nextBytes(noise);
        assertNull(read(noise, 240, 240));
    }

    @Test
    public void ignoresAnEmptyFrameInsteadOfThrowing() {
        assertNull(new QrDecode().read(0, 0, ByteBuffer.wrap(new byte[0]), 0, 1));
        assertNull(new QrDecode().read(240, 240, null, 240, 1));
    }

    @Test
    public void copiesPaddedRowsIntoATightArray() {
        // Two rows of three pixels, padded to a stride of five.
        ByteBuffer plane = ByteBuffer.allocate(10);
        plane.put(new byte[]{1, 2, 3, 9, 9, 4, 5, 6, 9, 9});
        plane.rewind();
        assertArrayEquals(new byte[]{1, 2, 3, 4, 5, 6}, QrDecode.toDenseLuminance(3, 2, plane, 5, 1));
    }

    @Test
    public void copiesInterleavedPixelsIntoATightArray() {
        ByteBuffer plane = ByteBuffer.allocate(6);
        plane.put(new byte[]{1, 9, 2, 9, 3, 9});
        plane.rewind();
        assertArrayEquals(new byte[]{1, 2, 3}, QrDecode.toDenseLuminance(3, 1, plane, 6, 2));
    }

    @Test
    public void stopsAtTheEndOfAShortBuffer() {
        // A truncated frame must not read past its end; whatever it got is kept and the rest is 0.
        ByteBuffer plane = ByteBuffer.wrap(new byte[]{1, 2, 3});
        byte[] out = QrDecode.toDenseLuminance(2, 2, plane, 2, 1);
        assertArrayEquals(new byte[]{1, 2, 3, 0}, out);
    }

    @Test
    public void aTinyImageIsNotACode() throws Exception {
        assertTrue(new QrDecode().read(8, 8, ByteBuffer.wrap(code(PAIRING, 8)), 8, 1) == null);
    }
}

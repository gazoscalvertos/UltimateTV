package tv.ultimate.scanner;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.Image;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The camera screen. One job: find a QR code, hand back its text, close.
 *
 * <p>Nothing here needs Google Play services, so it works on a phone with no Google apps at all
 * (which is the point of #198). The code is read on a background thread and the activity finishes
 * on the first result, because the TV's pairing code is the only thing this is for.
 */
// ComponentActivity, not Activity: CameraX binds the camera to a lifecycle, and only
// ComponentActivity is a LifecycleOwner.
public class QrScanActivity extends ComponentActivity {

    private ExecutorService worker;
    private final AtomicBoolean found = new AtomicBoolean(false);
    private PreviewView preview;
    private TextView message;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        worker = Executors.newSingleThreadExecutor();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(this);
        root.addView(preview, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        message = new TextView(this);
        message.setText("Point the phone at the code on the TV's screen");
        message.setTextColor(Color.WHITE);
        message.setTextSize(18f);
        message.setGravity(Gravity.CENTER);
        message.setPadding(dp(24), dp(24), dp(24), dp(48));
        FrameLayout.LayoutParams messageParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        messageParams.gravity = Gravity.BOTTOM;
        root.addView(message, messageParams);
        setContentView(root);

        root.setOnClickListener(v -> finishWithProblem(null));
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, 1);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != 1) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            // The typed code is a complete way to pair, so refusing the camera is not an error
            // worth blocking on: say where the letters are and let the caller show its field.
            finishWithProblem("The camera is switched off for this app. Type the code shown on the TV instead.");
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview previewUseCase = new Preview.Builder().build();
                previewUseCase.setSurfaceProvider(preview.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                QrDecode decoder = new QrDecode();
                analysis.setAnalyzer(worker, proxy -> readFrame(decoder, proxy));

                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, previewUseCase, analysis);
            } catch (Exception e) {
                finishWithProblem("The camera didn't start. Type the code shown on the TV instead.");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    /** One camera frame: look for a code, and close with its text when one is there. */
    private void readFrame(QrDecode decoder, ImageProxy proxy) {
        try {
            if (found.get()) return;
            Image image = proxy.getImage();
            String text = image == null ? null : decoder.read(image);
            if (text != null && !text.isEmpty() && found.compareAndSet(false, true)) {
                runOnUiThread(() -> finishWithText(text));
            }
        } finally {
            proxy.close();
        }
    }

    private void finishWithText(String text) {
        Intent data = new Intent();
        data.putExtra(QrScanner.EXTRA_TEXT, text);
        setResult(RESULT_OK, data);
        finish();
    }

    private void finishWithProblem(String problem) {
        Intent data = new Intent();
        if (problem != null) data.putExtra(QrScanner.EXTRA_PROBLEM, problem);
        setResult(problem == null ? RESULT_CANCELED : RESULT_FIRST_USER, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdownNow();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

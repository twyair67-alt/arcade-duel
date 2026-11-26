package com.twyair67.arcadeduel;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String GAME_URL = "https://arcade-duel.onrender.com/";

    private FrameLayout loadingOverlay;
    private TextView loadingMessage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showLoadingOverlay();
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                runOnUiThread(() -> showLoadingOverlay());
            }

            @Override
            public void onPageLoaded(WebView webView) {
                runOnUiThread(() -> hideLoadingOverlay());
            }
        });
        enterImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    private void showLoadingOverlay() {
        if (loadingOverlay == null) {
            loadingOverlay = new FrameLayout(this);
            loadingOverlay.setBackgroundColor(Color.BLACK);

            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setGravity(Gravity.CENTER);
            int horizontalPadding = dp(28);
            content.setPadding(horizontalPadding, dp(24), horizontalPadding, dp(24));

            TextView title = new TextView(this);
            title.setText("ARCADE DUEL");
            title.setTextColor(Color.rgb(49, 245, 255));
            title.setTextSize(28);
            title.setGravity(Gravity.CENTER);
            title.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
            content.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ));

            ProgressBar progress = new ProgressBar(this);
            LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(36), dp(36));
            progressParams.topMargin = dp(28);
            content.addView(progress, progressParams);

            loadingMessage = new TextView(this);
            loadingMessage.setText("Connessione al server di gioco...\\n\\nIl risveglio di Render puo richiedere 50 secondi o piu.");
            loadingMessage.setTextColor(Color.LTGRAY);
            loadingMessage.setTextSize(15);
            loadingMessage.setGravity(Gravity.CENTER);
            loadingMessage.setTypeface(android.graphics.Typeface.MONOSPACE);
            LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            messageParams.topMargin = dp(22);
            content.addView(loadingMessage, messageParams);

            Button retry = new Button(this);
            retry.setText("RIPROVA ORA");
            retry.setOnClickListener(view -> {
                loadingMessage.setText("Nuovo tentativo di connessione a Render...");
                bridge.getWebView().loadUrl(GAME_URL);
            });
            LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            retryParams.topMargin = dp(18);
            content.addView(retry, retryParams);

            loadingOverlay.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            ));
            ((ViewGroup) findViewById(android.R.id.content)).addView(loadingOverlay,
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
        } else {
            loadingOverlay.setVisibility(View.VISIBLE);
        }
    }

    private void hideLoadingOverlay() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @SuppressWarnings("deprecation")
    private void enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }

        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}

package com.openhamclock.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Android TV wrapper for OpenHamClock.
 *
 * <p>Full-screen WebView loading the hosted dashboard. D-pad arrows and
 * SELECT are passed to the page for navigation; BACK steps through WebView
 * history (double-press to exit); MENU reloads the dashboard (long-press
 * MENU opens the self-hosted server option).
 */
public class MainActivity extends Activity {

    /** Default dashboard; override on-device (see below) or via --es serverUrl. */
    private static final String DEFAULT_URL = "https://openhamclock.com/";

    private static final String PREFS = "ohc_tv";
    private static final String KEY_SERVER_URL = "server_url";

    private static final long BACK_EXIT_WINDOW_MS = 2000L;

    private WebView webView;
    private View errorOverlay;
    private long lastBackPressMs = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep the shack TV awake while the dashboard is visible.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        errorOverlay = findViewById(R.id.error_overlay);
        Button retryButton = findViewById(R.id.retry_button);
        retryButton.setOnClickListener(v -> reloadDashboard());
        Button serverButton = findViewById(R.id.server_button);
        if (serverButton != null) {
            serverButton.setOnClickListener(v -> showServerDialog());
        }

        configureWebView();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(resolveHomeUrl());
        }
    }

    /**
     * Effective dashboard URL. Precedence: adb/deep-link intent extra
     * {@code --es serverUrl http://pi:3000} &gt; saved preference from the
     * on-device server dialog &gt; {@link #DEFAULT_URL}.
     */
    private String resolveHomeUrl() {
        String fromIntent = getIntent() != null ? getIntent().getStringExtra("serverUrl") : null;
        String normalized = normalizeServerUrl(fromIntent);
        if (normalized != null) {
            getPrefs().edit().putString(KEY_SERVER_URL, normalized).apply();
            return normalized;
        }
        String saved = getPrefs().getString(KEY_SERVER_URL, null);
        String savedNorm = normalizeServerUrl(saved);
        if (savedNorm != null) {
            return savedNorm;
        }
        return DEFAULT_URL;
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** Returns a normalized http(s) URL with trailing slash, or null if invalid/empty. */
    private static String normalizeServerUrl(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim();
        if (s.isEmpty()) {
            return null;
        }
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            return null;
        }
        if (!s.endsWith("/")) {
            s += "/";
        }
        return s;
    }

    /** D-pad friendly server editor: Save persists, Reset clears back to default. */
    private void showServerDialog() {
        String current = webView != null && webView.getUrl() != null
                ? webView.getUrl()
                : getPrefs().getString(KEY_SERVER_URL, DEFAULT_URL);
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(current);
        input.setHint(DEFAULT_URL);
        input.setSingleLine(true);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(pad, pad, pad, 0);
        container.addView(input);

        AlertDialog dialog =
                new AlertDialog.Builder(this)
                        .setTitle(R.string.server_title)
                        .setMessage(R.string.server_message)
                        .setView(container)
                        .setPositiveButton(R.string.save, (d, which) -> {
                            String norm = normalizeServerUrl(input.getText().toString());
                            if (norm == null) {
                                Toast.makeText(this, R.string.server_invalid, Toast.LENGTH_SHORT).show();
                                return;
                            }
                            getPrefs().edit().putString(KEY_SERVER_URL, norm).apply();
                            hideError();
                            webView.loadUrl(norm);
                        })
                        .setNeutralButton(R.string.server_reset, (d, which) -> {
                            getPrefs().edit().remove(KEY_SERVER_URL).apply();
                            hideError();
                            webView.loadUrl(DEFAULT_URL);
                        })
                        .setNegativeButton(android.R.string.cancel, null)
                        .create();
        dialog.show();
        input.requestFocus();
        input.selectAll();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Identify TV traffic in server logs without breaking site feature detection.
        String defaultUa = settings.getUserAgentString();
        settings.setUserAgentString(defaultUa + " OpenHamClockTV/1.0 (Android TV; Leanback)");

        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus(View.FOCUS_DOWN);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            /** Keep http(s) inside the app; hand tel:/mailto:/app links to the OS. */
            private boolean handleUrl(String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                hideError();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideError();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError();
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showError();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showError();
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
    }

    private void reloadDashboard() {
        hideError();
        if (webView.getUrl() == null) {
            webView.loadUrl(resolveHomeUrl());
        } else {
            webView.reload();
        }
    }

    private void showError() {
        if (errorOverlay != null) {
            TextView detail = findViewById(R.id.error_detail);
            if (detail != null) {
                String url = webView != null && webView.getUrl() != null ? webView.getUrl() : resolveHomeUrl();
                detail.setText(getString(R.string.error_detail, url));
            }
            errorOverlay.setVisibility(View.VISIBLE);
            View retry = findViewById(R.id.retry_button);
            if (retry != null) {
                retry.requestFocus();
            }
        }
    }

    private void hideError() {
        if (errorOverlay != null) {
            errorOverlay.setVisibility(View.GONE);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPressMs < BACK_EXIT_WINDOW_MS) {
                finish();
                return true;
            }
            lastBackPressMs = now;
            Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
            return true;
        }
        // MENU short-press = reload (on key-up), long-press = server option.
        // We defer the reload to onKeyUp so a hold doesn't reload first.
        if (keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == KeyEvent.KEYCODE_INFO
                || keyCode == KeyEvent.KEYCODE_GUIDE) {
            // Required so onKeyLongPress fires on hold.
            event.startTracking();
            return true;
        }
        // Let D-pad arrows / SELECT / media keys reach the WebView untouched.
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == KeyEvent.KEYCODE_INFO
                || keyCode == KeyEvent.KEYCODE_GUIDE) {
            if (!event.isCanceled()) {
                reloadDashboard();
            }
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == KeyEvent.KEYCODE_INFO
                || keyCode == KeyEvent.KEYCODE_GUIDE) {
            showServerDialog();
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @SuppressWarnings("deprecation")
    private void enterImmersiveMode() {
        View decor = getWindow().getDecorView();
        int flags =
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        decor.setSystemUiVisibility(flags);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

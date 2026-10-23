package com.gioelerosana.xmapstudio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.Locale;

/**
 * La UI web di XMap Studio dentro un WebView a tutto schermo.
 * La build web è negli asset dell'APK e si serve sotto un'origine HTTPS locale
 * ({@link #ORIGIN_HOST}, dominio riservato da Android a questo scopo): niente rete,
 * niente {@code file://} (moduli ES e localStorage funzionano normalmente).
 */
public class MainActivity extends Activity {
    private static final String ORIGIN_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ORIGIN_HOST + "/index.html";
    private static final int REQUEST_OPEN = 1;
    private static final int REQUEST_SAVE = 2;

    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> pendingOpen;
    private byte[] pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupSystemBars();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        // Pinch e doppio tap sono gesti della mappa, non zoom della pagina.
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setBackgroundColor(Color.TRANSPARENT);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.addJavascriptInterface(new Bridge(), "xmapAndroid");
        webView.setWebViewClient(new AppClient());
        webView.setWebChromeClient(new ChromeClient());

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        setupSystemBars();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // Uscire chiude la mappa: le modifiche non salvate andrebbero perse.
        new AlertDialog.Builder(this)
                .setMessage("Uscire da XMap Studio? Le modifiche non salvate andranno perse.")
                .setNegativeButton("Annulla", null)
                .setPositiveButton("Esci", (dialog, which) -> finish())
                .show();
    }

    // Barre di sistema

    private boolean isNightMode() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /**
     * Da Android 15 (targetSdk 35) l'app è sempre edge-to-edge: il contenuto
     * va tenuto fuori da status bar, barra di navigazione e tastiera con un padding.
     */
    @SuppressWarnings("deprecation")
    private void setupSystemBars() {
        boolean night = isNightMode();
        int background = night ? Color.rgb(0x25, 0x25, 0x25) : Color.rgb(0xfc, 0xfc, 0xfc);
        root.setBackgroundColor(background);
        Window window = getWindow();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            window.setStatusBarColor(background);
            window.setNavigationBarColor(background);
            int flags = 0;
            if (!night) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
            return;
        }
        window.setDecorFitsSystemWindows(false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsController controller = window.getInsetsController();
        if (controller != null) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(night ? 0 : light, light);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout()
                    | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        root.requestApplyInsets();
    }

    // Selettore file (apertura) e salvataggio

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQUEST_OPEN) {
            ValueCallback<Uri[]> callback = pendingOpen;
            pendingOpen = null;
            if (callback != null) callback.onReceiveValue(uri != null ? new Uri[] {uri} : null);
        } else if (requestCode == REQUEST_SAVE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (uri != null && bytes != null) writeTo(uri, bytes);
        }
    }

    private void writeTo(Uri uri, byte[] bytes) {
        // "wt": tronca un file esistente invece di sovrascriverne solo l'inizio.
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException("destinazione non scrivibile");
            out.write(bytes);
            Toast.makeText(this, "File salvato", Toast.LENGTH_SHORT).show();
        } catch (IOException | SecurityException e) {
            new AlertDialog.Builder(this)
                    .setTitle("Salvataggio non riuscito")
                    .setMessage(String.valueOf(e.getMessage()))
                    .setPositiveButton("OK", null)
                    .show();
        }
    }

    /** API esposta alla pagina come {@code window.xmapAndroid}. */
    private final class Bridge {
        /** Chiede dove salvare (selettore di sistema) e scrive i byte ricevuti in base64. */
        @JavascriptInterface
        public void saveFile(String base64, String name, String mimeType) {
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return;
            }
            runOnUiThread(() -> {
                pendingSave = bytes;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, name == null || name.isEmpty() ? "map.xmind" : name);
                try {
                    startActivityForResult(intent, REQUEST_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "Nessuna app per salvare file", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    private final class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingOpen != null) pendingOpen.onReceiveValue(null);
            pendingOpen = callback;
            // `.xmind` non ha un tipo MIME noto ad Android: un filtro lo renderebbe non selezionabile.
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try {
                startActivityForResult(intent, REQUEST_OPEN);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingOpen = null;
                return false;
            }
        }
    }

    private final class AppClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (ORIGIN_HOST.equals(url.getHost())) return false;
            // I link esterni si aprono nel browser, la UI resta nell'app.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
                Toast.makeText(MainActivity.this, "Nessuna app per aprire il link", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!"https".equals(url.getScheme()) || !ORIGIN_HOST.equals(url.getHost())) return null;
            String path = url.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            // Niente risalite fuori dalla cartella web.
            if (path.contains("..")) return notFound();
            try {
                InputStream stream = getAssets().open("web" + path);
                WebResourceResponse response = new WebResourceResponse(mimeType(path), encoding(path), stream);
                response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return response;
            } catch (IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private static String encoding(String path) {
        String mime = mimeType(path);
        return mime.startsWith("text/") || mime.contains("json") ? "utf-8" : null;
    }

    private static String mimeType(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "map": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "wasm": return "application/wasm";
            case "xmind": return "application/vnd.xmind.workbook";
            default: return "application/octet-stream";
        }
    }
}

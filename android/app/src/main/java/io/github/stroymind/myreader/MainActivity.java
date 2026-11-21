package io.github.stroymind.myreader;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ActionMode;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static volatile String sPendingDeepLink = "";

    public static String consumePendingDeepLink() {
        String out = sPendingDeepLink == null ? "" : sPendingDeepLink;
        sPendingDeepLink = "";
        return out;
    }

    private void captureDeepLink(Intent intent, boolean dispatchToWeb) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String uri = data.toString();
        if (!uri.startsWith("zone://")) return;
        sPendingDeepLink = uri;
        if (dispatchToWeb) {
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) {
                String quoted = JSONObject.quote(uri);
                web.post(() -> web.evaluateJavascript(
                    "(function(){try{if(window.__app&&window.__app.openDeepLink)window.__app.openDeepLink(" + quoted + ");}catch(e){}})()",
                    null
                ));
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZoneVoicePlugin.class);
        registerPlugin(ZonePhoneUsePlugin.class);
        registerPlugin(ZoneShortcutPlugin.class);
        captureDeepLink(getIntent(), false);
        super.onCreate(savedInstanceState);
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            WebSettings ws = web.getSettings();
            ws.setSupportZoom(false);
            ws.setBuiltInZoomControls(false);
            ws.setDisplayZoomControls(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ws.setForceDark(WebSettings.FORCE_DARK_OFF);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ws.setAlgorithmicDarkeningAllowed(false);
            }
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript(
                    "(function(){try{return !!(window.__app&&window.__app.handleBack&&window.__app.handleBack());}catch(e){return false;}})()",
                    value -> {
                        if (!"true".equals(value)) moveTaskToBack(true);
                    }
                );
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureDeepLink(intent, true);
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (mode != null && mode.getMenu() != null) {
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) {
                web.evaluateJavascript(
                    "(function(){return document.body.classList.contains('selecting');})()",
                    v -> { if ("true".equals(v)) mode.getMenu().clear(); }
                );
            }
        }
        super.onActionModeStarted(mode);
    }
}

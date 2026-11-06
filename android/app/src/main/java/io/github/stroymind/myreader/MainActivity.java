package io.github.stroymind.myreader;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            WebSettings ws = web.getSettings();
            ws.setSupportZoom(false);
            ws.setBuiltInZoomControls(false);
            ws.setDisplayZoomControls(false);
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
}

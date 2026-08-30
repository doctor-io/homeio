package io.homeio.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * Back-button behaviour for the launcher.
 *
 * Capacitor's own handler does `canGoBack() ? goBack() : nothing` once the page
 * has no JS listener — and the launcher's listener dies the moment the WebView
 * navigates onto a server's origin. That left the button dead on a server's
 * first page: no history to pop, and no way back to the server list.
 *
 * This callback is registered after the plugins load, so it runs first.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = getBridge().getWebView();

                        if (webView.canGoBack()) {
                            webView.goBack();
                            return;
                        }

                        String localUrl = getBridge().getLocalUrl();
                        String current = webView.getUrl();

                        // On a server's first page: return to the launcher
                        // rather than stranding the user or quitting.
                        if (current != null && localUrl != null && !current.startsWith(localUrl)) {
                            webView.loadUrl(localUrl);
                            return;
                        }

                        // Already on the launcher, nothing left to go back to.
                        finish();
                    }
                }
            );
    }
}

package io.homeio.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Back-button behaviour for the launcher.
 *
 * Capacitor's own handler does `canGoBack() ? goBack() : nothing` once the page
 * has no JS listener — and the launcher's listener dies the moment the WebView
 * navigates onto a server's origin. That left the button dead on a server's
 * first page: no history to pop, and no way back to the server list.
 *
 * This callback is registered after the plugins load, so it runs first.
 *
 * The activity also owns downloads: a WebView does nothing at all with a
 * Content-Disposition: attachment response unless a DownloadListener is set, so
 * the Files screen's Download button was silently dead inside the app.
 *
 * And it owns the fallback to the desktop shell for servers older than the
 * phone UI, for the same reason: only the WebView ever sees the status code.
 *
 * The optional app lock lives here too, and could not live anywhere else: the
 * launcher's JavaScript dies the moment the WebView navigates onto a server, so
 * it cannot be what stands between the phone and a signed-in dashboard.
 */
public class MainActivity extends BridgeActivity {

    /** Capacitor Preferences writes the launcher's toggle into this file. */
    private static final String PREFERENCES_FILE = "CapacitorStorage";
    private static final String LOCK_ENABLED_KEY = "homeio.biometricLock";
    private static final String AUTO_RECONNECT_KEY = "homeio.autoReconnect";

    /**
     * How long the app may sit in the background before it asks again. Short
     * enough that a lost phone is not an open door, long enough that stepping
     * out to a password manager and back is not an interrogation.
     */
    private static final long RELOCK_AFTER_MS = 60_000L;

    private boolean unlocked = false;
    private boolean prompting = false;
    private long backgroundedAt = 0L;

    /**
     * The moment the user stopped looking, which is not something the activity
     * lifecycle can tell us: behind the keyguard Android starts and stops the
     * activity over and over — measured at 40-90ms per cycle on the test device
     * — and every stop would reset the clock the re-lock decision runs on. The
     * screen going off is the one signal that means what it says.
     */
    private final BroadcastReceiver screenOffReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            backgroundedAt = System.currentTimeMillis();
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerDownloadListener();
        registerPhoneUiFallback();
        registerSettingsBridge();
        registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));

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

    /**
     * Hand downloads to Android's DownloadManager, which writes to the phone's
     * Downloads folder and shows the usual notification and progress.
     *
     * The session cookie has to be copied onto the request by hand: the manager
     * runs outside the WebView, so it starts with no cookies and Homeio would
     * answer the download URL with the login page instead of the file.
     */
    private void registerDownloadListener() {
        WebView webView = getBridge().getWebView();

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String fileName = fileNameFor(url, contentDisposition, mimeType);

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) {
                request.addRequestHeader("Cookie", cookie);
            }
            if (userAgent != null) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            request.setMimeType(mimeType);
            request.setTitle(fileName);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            );

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            manager.enqueue(request);

            Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
        });
    }

    private static final Pattern DISPOSITION_FILE_NAME = Pattern.compile(
        "filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?",
        Pattern.CASE_INSENSITIVE
    );

    /**
     * Take the name straight from Content-Disposition when the header has one.
     *
     * URLUtil.guessFileName reads that header too, but then rewrites the
     * extension to match the MIME type — a readme.md served as text/markdown
     * lands in Downloads as readme.txt. It stays the fallback for responses
     * that carry no filename at all.
     */
    private static String fileNameFor(String url, String contentDisposition, String mimeType) {
        if (contentDisposition != null) {
            Matcher matcher = DISPOSITION_FILE_NAME.matcher(contentDisposition);
            if (matcher.find()) {
                String name = matcher.group(1).trim();
                try {
                    name = URLDecoder.decode(name, "UTF-8");
                } catch (UnsupportedEncodingException | IllegalArgumentException ignored) {
                    // Not percent-encoded; the raw value is already the name.
                }
                // Never let a name escape the Downloads folder.
                name = new java.io.File(name).getName();
                if (!name.isEmpty()) {
                    return name;
                }
            }
        }

        return URLUtil.guessFileName(url, contentDisposition, mimeType);
    }

    /**
     * Fall back to the desktop shell when a server has no phone UI.
     *
     * The launcher sends every server to `<origin>/m`, and one from before that
     * route existed answers with its own 404. The launcher cannot tell that
     * apart from a healthy server: it probes cross-origin, where a `no-cors`
     * response is opaque and carries no status. The WebView is the only place
     * the status code is visible, so the fallback lives here.
     *
     * History is cleared afterwards so Back does not walk straight into the 404
     * again — with no history left, the activity's Back handler returns to the
     * server list, which is where Back should go from a server's first page.
     */
    private void registerPhoneUiFallback() {
        WebView webView = getBridge().getWebView();

        webView.setWebViewClient(
            new BridgeWebViewClient(getBridge()) {
                private String pendingRoot = null;

                @Override
                public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse errorResponse
                ) {
                    super.onReceivedHttpError(view, request, errorResponse);

                    // Subresources 404 for all sorts of harmless reasons; only
                    // the page itself means "this server has no /m".
                    if (!request.isForMainFrame() || errorResponse.getStatusCode() != 404) {
                        return;
                    }

                    Uri uri = request.getUrl();
                    String path = uri.getPath();
                    if (path == null || !(path.equals("/m") || path.startsWith("/m/"))) {
                        return;
                    }

                    String root = uri.getScheme() + "://" + uri.getAuthority() + "/";
                    pendingRoot = root;
                    view.post(() -> view.loadUrl(root));
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);

                    if (pendingRoot != null && url != null && url.startsWith(pendingRoot)) {
                        pendingRoot = null;
                        view.clearHistory();
                    }
                }
            }
        );
    }

    private boolean isLockEnabled() {
        SharedPreferences preferences = getSharedPreferences(PREFERENCES_FILE, MODE_PRIVATE);
        return "true".equals(preferences.getString(LOCK_ENABLED_KEY, "false"));
    }

    @Override
    public void onStart() {
        super.onStart();

        if (!isLockEnabled()) {
            unlocked = true;
            showContent();
            return;
        }

        boolean awayTooLong = backgroundedAt > 0
            && System.currentTimeMillis() - backgroundedAt > RELOCK_AFTER_MS;

        if (!unlocked || awayTooLong) {
            unlocked = false;
            hideContent();
            promptForUnlock();
            return;
        }

        // Back inside the grace window — a screen switched off and on again is
        // the common case. onStop hid the WebView on the way out, and nothing
        // else will ever put it back: without this the app returns to a black
        // rectangle that still has focus and still answers nothing.
        showContent();
    }

    @Override
    public void onStop() {
        super.onStop();

        // Only while the screen is still on, which means this is a real app
        // switch. A stop with the screen already off is keyguard churn, and the
        // receiver above has already recorded the honest timestamp.
        PowerManager power = getSystemService(PowerManager.class);
        if (power == null || power.isInteractive()) {
            backgroundedAt = System.currentTimeMillis();
        }

        // Hidden on the way out, not on the way back: the system takes the
        // recents thumbnail around here, and the dashboard should not be in it.
        if (isLockEnabled()) {
            hideContent();
        }
    }

    private void showContent() {
        WebView webView = getBridge().getWebView();
        webView.setVisibility(View.VISIBLE);
    }

    private void hideContent() {
        WebView webView = getBridge().getWebView();
        webView.setVisibility(View.INVISIBLE);
    }

    /**
     * Face or fingerprint, falling back to the device PIN — never to nothing.
     * A device with no enrolled biometric and no screen lock has nothing to
     * check against, so the lock stands down rather than locking the owner out
     * of their own server.
     */
    private void promptForUnlock() {
        if (prompting) {
            return;
        }

        int authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

        if (BiometricManager.from(this).canAuthenticate(authenticators)
            != BiometricManager.BIOMETRIC_SUCCESS) {
            unlocked = true;
            showContent();
            return;
        }

        prompting = true;

        BiometricPrompt prompt = new BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(
                    @NonNull BiometricPrompt.AuthenticationResult result
                ) {
                    prompting = false;
                    unlocked = true;
                    showContent();
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence message) {
                    prompting = false;

                    boolean userWalkedAway = errorCode == BiometricPrompt.ERROR_USER_CANCELED
                        || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON;

                    if (userWalkedAway) {
                        // Cancelling is a decision, not a retry: re-prompting in
                        // a loop is the behaviour people force-quit an app over.
                        // The app closes, still locked, and asks again next launch.
                        finish();
                        return;
                    }

                    // Everything else — the system cancelling because the screen
                    // went off, a lockout after too many attempts — leaves the
                    // app locked and asks again on the next onStart. Closing on
                    // these would mean the screen timing out mid-prompt quietly
                    // quit the app.
                }
            }
        );

        prompt.authenticate(
            new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Homeio")
                .setSubtitle("Your server is signed in on this device")
                .setAllowedAuthenticators(authenticators)
                .build()
        );
    }

    @Override
    public void onDestroy() {
        unregisterReceiver(screenOffReceiver);
        super.onDestroy();
    }

    /**
     * The app's own settings, readable and writable from Homeio's UI.
     *
     * These live in the app's storage on its own origin, and /m is served by the
     * server, so the page cannot reach them by itself — Capacitor injects its
     * bridge into the local origin only. This is the one thing that crosses that
     * line, and it is deliberately narrow: two booleans, nothing else.
     *
     * A JavaScript interface is exposed to every page the WebView loads,
     * including a server that has been compromised, so **turning the lock off
     * requires the fingerprint or PIN**. A hostile page calling this gets a
     * prompt the owner refuses. Turning it on only strengthens the gate, and
     * reconnect-on-open is not a security setting, so neither asks.
     */
    private class SettingsBridge {

        @JavascriptInterface
        public String read() {
            SharedPreferences preferences = getSharedPreferences(PREFERENCES_FILE, MODE_PRIVATE);
            return "{\"lock\":" + "true".equals(preferences.getString(LOCK_ENABLED_KEY, "false"))
                + ",\"autoReconnect\":"
                + !"false".equals(preferences.getString(AUTO_RECONNECT_KEY, "true"))
                + "}";
        }

        @JavascriptInterface
        public void setAutoReconnect(boolean enabled) {
            write(AUTO_RECONNECT_KEY, enabled);
            announce();
        }

        @JavascriptInterface
        public void setLock(boolean enabled) {
            if (enabled) {
                write(LOCK_ENABLED_KEY, true);
                unlocked = true;
                announce();
                return;
            }

            runOnUiThread(() -> confirmThen(() -> {
                write(LOCK_ENABLED_KEY, false);
                announce();
            }));
        }
    }

    private void write(String key, boolean value) {
        getSharedPreferences(PREFERENCES_FILE, MODE_PRIVATE)
            .edit()
            .putString(key, value ? "true" : "false")
            .apply();
    }

    /** Tell the page the values changed, so it can redraw from the truth. */
    private void announce() {
        WebView webView = getBridge().getWebView();
        webView.post(() ->
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('homeio:app-settings'))",
                null
            )
        );
    }

    /** The same authenticators the lock itself accepts, for the same reason. */
    private void confirmThen(Runnable onConfirmed) {
        int authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

        int canAuth = BiometricManager.from(this).canAuthenticate(authenticators);

        // Two different "no" answers, and treating them alike is a hole. A
        // device with nothing enrolled could never have enforced the lock, so
        // refusing there would strand the setting on with no way back. But
        // "unavailable right now" — the sensor still busy from the unlock a
        // moment ago, or a lockout after failed attempts — is temporary, and
        // taking it as permission is how a tap silently turned the lock off
        // once during testing.
        boolean permanentlyUnavailable =
            canAuth == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                || canAuth == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
                || canAuth == BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED;

        if (permanentlyUnavailable) {
            onConfirmed.run();
            return;
        }

        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            // Temporarily unable to ask, so the answer is no. The page is told
            // so the switch goes back to where the setting actually is.
            announce();
            return;
        }

        new BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(
                    @NonNull BiometricPrompt.AuthenticationResult result
                ) {
                    onConfirmed.run();
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence message) {
                    // Left as it was, and the page is told so it can put the
                    // switch back where it belongs.
                    announce();
                }
            }
        ).authenticate(
            new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Turn off the app lock?")
                .setSubtitle("Homeio will open without asking")
                .setAllowedAuthenticators(authenticators)
                .build()
        );
    }

    private void registerSettingsBridge() {
        getBridge().getWebView().addJavascriptInterface(new SettingsBridge(), "HomeioApp");
    }
}

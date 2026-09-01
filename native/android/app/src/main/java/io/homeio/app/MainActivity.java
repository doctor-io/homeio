package io.homeio.app;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
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
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerDownloadListener();
        registerPhoneUiFallback();

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
}

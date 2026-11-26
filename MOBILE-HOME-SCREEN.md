# Home screen installation

Homeio can be added to the home screen as an online web app. On iPhone, open the Homeio address in Safari, tap Share, then **Add to Home Screen**. On iOS 26 or later, leave **Open as Web App** enabled. Sign in when prompted; the installed app may have a separate session from Safari. Android users can use Chrome's install or add-to-home-screen menu when available.

On a phone, **Home** lists installed apps and their status. Use the bottom bar to switch to **Files**, **Store** or **Monitor**. **More** opens Settings, disks, Terminal and session controls. In Files, tap an item to open it or tap **Select** to work with multiple items.

The existing HTTP LAN address can still be opened and, on supported iOS versions, added to the home screen. HTTP on a LAN address is not a secure context: browser installation features and prompts vary, and credentials and traffic are not protected from interception on the network. For the broadest browser support, use a trusted HTTPS address, such as an existing properly configured tunnel. Switching addresses changes the web origin and may require signing in again. No deployment or TLS change is required by this feature.

The app is online-first: it requires the server and network to be reachable. It does not register a service worker or cache dashboard pages, API responses, or user data for offline use. The manifest and icons are public static files and are included with the `public` directory in the standalone Docker build. The separate Capacitor mobile shell continues to load the server's web app as before.

References: [WebKit on Home Screen web apps](https://webkit.org/blog/13878/), [WebKit on iOS 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Chrome installation criteria](https://developer.chrome.com/blog/update-install-criteria), and [Next.js manifest documentation](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest).

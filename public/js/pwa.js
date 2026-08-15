/**
 * Registers the service worker so Chrome offers "Add to Home Screen" /
 * "Install app" on Android (and desktop). Silently no-ops in browsers
 * without support instead of throwing.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

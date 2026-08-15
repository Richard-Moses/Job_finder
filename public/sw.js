/**
 * Minimal service worker, present mainly to satisfy Chrome's PWA
 * installability criteria (a registered service worker with a fetch
 * handler). Deliberately does no caching -- this app calls live,
 * auth-gated API endpoints and gets redeployed often, so serving stale
 * cached responses would cause more problems than it would solve.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

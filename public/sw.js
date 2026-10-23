/* Our Home service worker (Phase 1.2b).
 *
 * Privacy-safe by design: this worker deliberately caches NOTHING and does not
 * intercept fetches. Pages, API responses and documents are private household
 * data and devices may be shared, so no HTML or authenticated data is stored.
 * It exists only so the app is installable as a PWA.
 *
 * It also handles Web Push ('push' / 'notificationclick'). Any future offline
 * support must exclude authenticated content.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only same-origin relative paths are ever opened from a notification. */
function safeLink(link) {
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//") || link.includes("\\")) return "/";
  return link;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (!data || typeof data !== "object") data = {};
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 100) : "Our Home";
  const body = typeof data.body === "string" ? data.body.slice(0, 300) : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: safeLink(data.link) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeLink(event.notification.data && event.notification.data.link), self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === target.origin && "focus" in c) {
          if ("navigate" in c) c.navigate(target.href);
          return c.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

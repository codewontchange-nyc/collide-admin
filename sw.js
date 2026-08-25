/* Collide Admin service worker — web push only (no caching). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "Collide", {
    body: d.body || "",
    icon: "https://codewontchange-nyc.github.io/Collide/icons/icon-192.png",
    badge: "https://codewontchange-nyc.github.io/Collide/icons/icon-192.png",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
    for (const t of tabs) if (t.url.startsWith(self.registration.scope)) return t.focus();
    return self.clients.openWindow(url);
  }));
});

/* Les Émirs — owner push notifications */
self.addEventListener("push", function (event) {
  let data = {};
  try { data = event.data.json(); } catch (e) {}
  const title = data.title || "Les Émirs";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      /* a unique tag per alert so a cancellation never silently replaces an
         earlier notification; renotify + vibrate make the phone alert again */
      tag: data.tag || ("emirs-" + Date.now()),
      renotify: true,
      requireInteraction: true,   /* stay on screen until the staff taps it — never auto-dismiss */
      vibrate: [200, 90, 200, 90, 200],
      data: { url: data.url || "/admin" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if (c.url.includes(url) && "focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

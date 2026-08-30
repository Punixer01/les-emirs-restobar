/* Les Émirs — owner push notifications */
self.addEventListener("push", function (event) {
  let data = {};
  try { data = event.data.json(); } catch (e) {}
  const title = data.title || "Les Émirs";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: "emirs-reservation",
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

// Service worker: enables "Add to Home Screen" install, and receives
// push notifications from the server even when the app is closed.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A real push notification arrived from the server — show it.
self.addEventListener('push', (event) => {
  let payload = { title: 'Task due now', body: 'You have a task due.' };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) {
    // fall back to default payload above
  }

  // Recurring reminders are marked alarm:true — make them vibrate and stay
  // on screen (like a phone alarm) instead of a quiet, easy-to-miss toast.
  // `tag` + `renotify` make sure the phone alerts again on every loop, not
  // just the very first time this reminder fires.
  const options = {
    body: payload.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
  };
  if (payload.alarm) {
    options.vibrate = [300, 150, 300, 150, 300, 150, 600];
    options.requireInteraction = true; // stays visible until the user dismisses it
  }
  if (payload.tag) {
    options.tag = payload.tag;
    options.renotify = true; // re-alert even though the tag repeats each loop
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Focus/open the app when the notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

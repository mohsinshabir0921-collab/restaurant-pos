const SW_VERSION = 'v4';

// Install - take control immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate - claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push event handling
self.addEventListener('push', (event) => {
  let payload = {};
  
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    // Malformed payload - use fallback
    payload = {
      title: 'New Order',
      body: 'A new order has been received',
      data: { url: '/pos/orders' }
    };
  }

  const { title, body, data } = payload;
  const notificationData = data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Determine whether the user is actively looking at a /pos window. If
        // so, that page's foreground handler plays the custom alert audio, so
        // the OS notification is shown silently to avoid double sound. The OS
        // notification is ALWAYS shown regardless of focus: push messages that
        // never call showNotification() are treated by browsers/FCM as "no
        // notification" and are routinely dropped, which is why a focused-only
        // suppression broke deliveries on backgrounded/minimized devices.
        const focusedPos = clientList.some((client) => {
          let pathname = '';
          try {
            pathname = new URL(client.url).pathname;
          } catch {
            return false;
          }
          return pathname.startsWith('/pos') && client.visibilityState === 'visible' && client.focused === true;
        });

        // Notify focused POS windows so their custom sound still plays.
        if (focusedPos) {
          clientList.forEach((client) => {
            let pathname = '';
            try {
              pathname = new URL(client.url).pathname;
            } catch {
              return;
            }
            if (pathname.startsWith('/pos') && client.visibilityState === 'visible' && client.focused === true) {
              client.postMessage({ type: 'POS_NEW_ORDER' });
            }
          });
        }

        const options = {
          body: body || 'New order received',
          icon: '/icons.svg',
          badge: '/favicon.svg',
          data: {
            url: notificationData.url || '/pos/orders',
            orderId: notificationData.orderId,
            orderNumber: notificationData.orderNumber,
            ...notificationData
          },
          actions: [
            {
              action: 'view',
              title: 'View Order'
            },
            {
              action: 'dismiss',
              title: 'Dismiss'
            }
          ],
          requireInteraction: true,
          // When a focused POS window already plays the custom mp3, keep the OS
          // notification silent. In all other cases (background/minimized/closed)
          // let the browser play the custom sound.
          silent: focusedPos,
          sound: '/new-order-alert.mp3',
          vibrate: [200, 100, 200]
        };

        return self.registration.showNotification(title || 'New Order', options);
      })
      .catch(() => {})
  );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const urlToOpen = event.notification.data?.url || '/pos/orders';

  if (action === 'dismiss') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing POS window if open
        for (const client of clientList) {
          if (client.url.includes('/pos')) {
            return client.focus();
          }
        }
        // Open new window
        return clients.openWindow(urlToOpen);
      })
      .catch(() => {
        return clients.openWindow(urlToOpen);
      })
  );
});

// Notification close handling
self.addEventListener('notificationclose', (event) => {
  // Optional: track dismissed notifications
  console.log('Notification closed', event.notification.data);
});
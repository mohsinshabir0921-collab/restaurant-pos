const SW_VERSION = 'v2';

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
      data: { url: '/' }
    };
  }

  const { title, body, data } = payload;
  const notificationData = data || {};

  const options = {
    body: body || 'New order received',
    icon: '/icons.svg',
    badge: '/favicon.svg',
    data: {
      url: notificationData.url || '/orders',
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
    silent: false,
    sound: '/new-order-alert.mp3',
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title || 'New Order', options)
  );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const urlToOpen = event.notification.data?.url || '/orders';

  if (action === 'dismiss') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing POS window if open
        for (const client of clientList) {
          if (client.url.includes('/orders') || client.url.includes('pos')) {
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

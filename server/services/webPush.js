const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure VAPID keys
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@restaurant.com';

if (!publicKey || !privateKey) {
  console.warn('VAPID keys not configured - push notifications will not work');
}

webpush.setVapidDetails(subject, publicKey, privateKey);

// Derive a short, stable, non-sensitive device identifier from a push
// subscription. Never logs the full endpoint, keys, or push tokens.
const maskEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint);
    const host = url.host || "unknown";
    const tail = (url.pathname || "").replace(/\/+$/, "").slice(-12);
    return `${host}…${tail}`;
  } catch {
    return "unknown-endpoint";
  }
};

class WebPushService {
  /**
   * Send push notification to a specific subscription.
   * Logs every delivery attempt with a masked device identifier, the outcome,
   * and the HTTP/error code so Android-vs-desktop delivery failures are
   * visible in the logs.
   */
  static async sendToSubscription(subscription, payload) {
    const startedAt = new Date().toISOString();
    const device = maskEndpoint(subscription.endpoint);
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      console.log(
        `[push] ${startedAt} device=${device} status=success`
      );
      return true;
    } catch (error) {
      const code = error.statusCode ?? "ERR";
      // Handle expired/invalid subscriptions. 404 (not found), 410 (gone), and
      // 403 (expired/invalid keys for this subscription) are permanent and the
      // row is deactivated. Temporary failures (5xx, 429, network errors) are
      // logged but never deactivate a subscription.
      const permanent = code === 403 || code === 404 || code === 410;
      console.log(
        `[push] ${startedAt} device=${device} status=${permanent ? "failed-permanent" : "failed-transient"} code=${code} msg=${(error.message || "").slice(0, 200)}`
      );
      if (permanent) {
        await PushSubscription.findOneAndUpdate(
          { endpoint: subscription.endpoint },
          { isActive: false }
        );
        console.log(
          `[push] ${startedAt} device=${device} action=deactivated-inactive code=${code}`
        );
        return false;
      }
      return false;
    }
  }

  /**
   * Send new order notification to all active POS subscriptions
   */
  static async sendNewOrderNotification(order) {
    if (!publicKey || !privateKey) {
      console.warn('VAPID keys not configured, skipping push notification');
      return;
    }

    try {
      const subscriptions = await PushSubscription.find({ 
        isActive: true 
      }).populate('user', 'name role');

      if (subscriptions.length === 0) {
        return;
      }

      const payload = {
        title: 'New Order',
        body: `${order.orderNumber} · ₹${order.total}`,
        data: {
          url: '/pos/orders',
          orderId: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          amount: order.total
        }
      };

      const results = await Promise.all(
        subscriptions.map(async (sub) => {
          const subscriptionObj = {
            endpoint: sub.endpoint,
            keys: sub.keys
          };
          return this.sendToSubscription(subscriptionObj, payload);
        })
      );

      const delivered = results.filter(Boolean).length;
      const failed = results.length - delivered;
      console.log(
        `[push] new-order: targeted=${results.length} delivered=${delivered} failed=${failed}`
      );
    } catch (error) {
      console.error('Error sending new order push notifications:', error.message);
    }
  }

  /**
   * Get VAPID public key for frontend
   */
  static getPublicKey() {
    return publicKey;
  }
}

module.exports = WebPushService;

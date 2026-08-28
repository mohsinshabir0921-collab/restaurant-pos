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

class WebPushService {
  /**
   * Send push notification to a specific subscription
   */
  static async sendToSubscription(subscription, payload) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      return true;
    } catch (error) {
      // Handle expired/invalid subscriptions. 404 (not found), 410 (gone), and
      // 403 (expired/invalid keys for this subscription) are permanent and the
      // row is deactivated. Temporary failures (5xx, 429, network errors) are
      // logged but never deactivate a subscription.
      if (error.statusCode === 403 || error.statusCode === 404 || error.statusCode === 410) {
        console.log('Push subscription expired or invalid, removing:', subscription.endpoint);
        await PushSubscription.findOneAndUpdate(
          { endpoint: subscription.endpoint },
          { isActive: false }
        );
        return false;
      }
      console.error('Push notification error:', error.message);
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
          url: '/orders',
          orderId: order._id,
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          amount: order.total
        }
      };

      const promises = subscriptions.map(async (sub) => {
        const subscriptionObj = {
          endpoint: sub.endpoint,
          keys: sub.keys
        };
        const result = await this.sendToSubscription(subscriptionObj, payload);
        return result;
      });

      await Promise.allSettled(promises);
      console.log(`New order push sent to ${subscriptions.length} POS devices`);
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

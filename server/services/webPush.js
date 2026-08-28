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
      // Handle expired/invalid subscriptions
      if (error.statusCode === 404 || error.statusCode === 410) {
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
    console.log('[PUSH DEBUG] sendNewOrderNotification entered');
    
    const vapidConfigured = !!(publicKey && privateKey);
    console.log(`[PUSH DEBUG] VAPID configuration present: ${vapidConfigured}`);
    
    if (!publicKey || !privateKey) {
      console.warn('VAPID keys not configured, skipping push notification');
      return;
    }

    try {
      const subscriptions = await PushSubscription.find({ 
        isActive: true 
      }).populate('user', 'name role');

      console.log(`[PUSH DEBUG] Active subscriptions found: ${subscriptions.length}`);

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

      console.log(`[PUSH DEBUG] Sending push to ${subscriptions.length} subscription(s)`);

      const promises = subscriptions.map(async (sub) => {
        const subscriptionObj = {
          endpoint: sub.endpoint,
          keys: sub.keys
        };
        try {
          const result = await this.sendToSubscription(subscriptionObj, payload);
          console.log('[PUSH DEBUG] Push result: success');
          return result;
        } catch (err) {
          console.log(`[PUSH DEBUG] Push result: failed status=${err.statusCode || 'unknown'} message=${err.message || 'unknown'}`);
          return false;
        }
      });

      await Promise.allSettled(promises);
      console.log(`New order push sent to ${subscriptions.length} POS devices`);
    } catch (error) {
      console.error('Error sending new order push notifications:', error.message);
    } finally {
      console.log('[PUSH DEBUG] sendNewOrderNotification completed');
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

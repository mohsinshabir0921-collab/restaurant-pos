const PushSubscription = require('../models/PushSubscription');
const WebPushService = require('../services/webPush');

const subscribePush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription data'
      });
    }

    // Upsert subscription for authenticated user
    const subscription = await PushSubscription.findOneAndUpdate(
      { 
        user: req.user._id,
        endpoint 
      },
      {
        user: req.user._id,
        endpoint,
        keys,
        isActive: true,
        userAgent: req.get('User-Agent'),
        lastUsedAt: new Date()
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );

    res.json({
      success: true,
      subscription,
      message: 'Push subscription saved'
    });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save subscription'
    });
  }
};

const unsubscribePush = async (req, res) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint required'
      });
    }

    await PushSubscription.findOneAndUpdate(
      { 
        user: req.user._id,
        endpoint 
      },
      { isActive: false }
    );

    res.json({
      success: true,
      message: 'Push subscription removed'
    });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove subscription'
    });
  }
};

const getVapidPublicKey = async (req, res) => {
  try {
    const publicKey = WebPushService.getPublicKey();
    
    if (!publicKey) {
      return res.status(500).json({
        success: false,
        message: 'VAPID keys not configured'
      });
    }

    res.json({
      success: true,
      publicKey
    });
  } catch (error) {
    console.error('Get VAPID key error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get VAPID key'
    });
  }
};

module.exports = {
  subscribePush,
  unsubscribePush,
  getVapidPublicKey
};

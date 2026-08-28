import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export const usePosPushNotifications = () => {
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [loading, setLoading] = useState(false);

  // Check notification permission and subscription status
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);

    if (Notification.permission === 'granted') {
      checkSubscription();
    }
  }, [user]);

  const checkSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      alert('Notifications are not supported in this browser');
      return false;
    }

    const permission = await Notification.requestPermission();
    setPermission(permission);
    
    return permission === 'granted';
  }, []);

  const saveSubscriptionToBackend = useCallback(async (subscription) => {
    // Send subscription to backend - use API client for automatic JWT attachment
    const api = await import('../services/api').then(m => m.default);
    await api.post('/push/subscribe', {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))),
        auth: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth'))))
      }
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!user || !VAPID_PUBLIC_KEY) {
      alert('Push notifications require authentication and VAPID key');
      return false;
    }

    if (permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) return false;
    }

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Reuse an existing subscription when one is already registered so a
      // duplicate browser subscription is never created. The subscription is
      // always re-saved to the backend (idempotent upsert) so the active DB
      // row matches the browser's current endpoint + keys.
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // Convert VAPID key to Uint8Array
        const urlBase64ToUint8Array = (base64String) => {
          const padding = '='.repeat((4 - base64String.length % 4) % 4);
          const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
          }
          return outputArray;
        };

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      await saveSubscriptionToBackend(subscription);

      setIsSubscribed(true);
      return true;
    } catch (error) {
      console.error('Subscription error:', error);
      alert('Failed to enable notifications: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, permission, requestPermission, saveSubscriptionToBackend]);

  const unsubscribe = useCallback(async () => {
    if (!user) return false;

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        const api = await import('../services/api').then(m => m.default);
        await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });

        await subscription.unsubscribe();
        setIsSubscribed(false);
      }
      return true;
    } catch (error) {
      console.error('Unsubscribe error:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [user]);

  return {
    isSubscribed,
    permission,
    loading,
    subscribe,
    unsubscribe,
    requestPermission
  };
};

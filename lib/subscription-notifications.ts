import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const NOTIF_IDS_KEY = 'voyage_sub_notif_ids';

/**
 * Request notification permissions if not already granted.
 * Returns true if permissions are granted.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Cancel all previously scheduled subscription notifications.
 */
export async function cancelSubscriptionNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const subNotifs = scheduled.filter((n) =>
      n.content.data?.type === 'subscription'
    );
    await Promise.all(subNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch (err) {
    console.warn('[SubNotifs] Failed to cancel notifications:', err);
  }
}

/**
 * Schedule a subscription confirmation notification (immediate).
 */
export async function sendSubscriptionConfirmedNotification(plan: 'monthly' | 'annual'): Promise<void> {
  if (Platform.OS === 'web') return;
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Welcome to Voyage Pro! ✈️',
        body: `Your ${plan === 'annual' ? 'annual' : 'monthly'} subscription is now active. Happy travels!`,
        data: { type: 'subscription', action: 'open_home' },
        sound: 'default',
      },
      trigger: null, // Immediate
    });
  } catch (err) {
    console.warn('[SubNotifs] Failed to send confirmation notification:', err);
  }
}

/**
 * Schedule a renewal reminder 3 days before subscription expires.
 */
export async function scheduleRenewalReminder(expiresAt: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  const reminderDate = new Date(expiresAt.getTime() - 3 * 24 * 60 * 60 * 1000);
  if (reminderDate <= new Date()) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Subscription renewing soon',
        body: 'Your Voyage Pro subscription renews in 3 days.',
        data: { type: 'subscription', action: 'open_profile' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
      },
    });
  } catch (err) {
    console.warn('[SubNotifs] Failed to schedule renewal reminder:', err);
  }
}

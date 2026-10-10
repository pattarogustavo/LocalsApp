import * as Notifications from 'expo-notifications';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTranslations, type Translations } from '@/i18n';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import type { Trip } from '@/types/voyage';

// iOS caps pending notifications at 64, and flight check-in/boarding
// reminders already use some of that budget — 20 trips × 2 reminders each
// keeps trip reminders well under the limit on their own.
const MAX_TRIPS = 20;
const DECLINED_KEY = 'voyage_trip_reminders_declined';

function reminderId(tripId: string, offset: '7d' | '1d'): string {
  return `trip-${tripId}-${offset}`;
}

async function hasDeclinedBefore(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DECLINED_KEY)) === 'true';
  } catch {
    return false;
  }
}

async function markDeclined(): Promise<void> {
  try {
    await AsyncStorage.setItem(DECLINED_KEY, 'true');
  } catch {}
}

async function getCurrentTranslations(): Promise<Translations> {
  // Dynamic import avoids a static import cycle: store/auth.ts already
  // imports store/trips.ts (for logout), and store/trips.ts calls into this
  // file — a static `import { useAuthStore } from '@/store/auth'` here
  // would complete that cycle.
  const { useAuthStore } = await import('@/store/auth');
  return getTranslations(useAuthStore.getState().preferredLanguage ?? 'pt');
}

/**
 * Shows our own explanatory alert before the system permission prompt, and
 * only when there's actually something to schedule. Remembers a decline —
 * ours or the system's — so we never ask again.
 *
 * Exported so other features that need the same OS notification permission
 * (e.g. lib/push.ts, for push-token registration) can reuse this exact
 * ask-once/remember-the-decline flow instead of prompting separately — it's
 * the same underlying permission either way.
 */
export async function ensurePermission(t?: Translations): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (await hasDeclinedBefore()) return false;

  const translations = t ?? (await getCurrentTranslations());
  const wantsToTry = await new Promise<boolean>((resolve) => {
    Alert.alert(
      translations.notifications.tripRemindersPermissionTitle,
      translations.notifications.tripRemindersPermissionBody,
      [
        { text: translations.notifications.notNow, style: 'cancel', onPress: () => resolve(false) },
        { text: translations.notifications.enableNotifications, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!wantsToTry) {
    await markDeclined();
    return false;
  }

  const { status: requested } = await Notifications.requestPermissionsAsync();
  if (requested !== 'granted') {
    await markDeclined();
    return false;
  }
  return true;
}

function destinationNameOf(trip: Trip): string {
  return trip.destinations?.[0]?.name || trip.name || '';
}

/** Trips shared with this account that it has accepted — not present in the owned-trips store. */
async function fetchAcceptedSharedTrips(): Promise<Trip[]> {
  try {
    const shared = await trpcVanilla.sharing.listSharedWithMe.query();
    return shared
      .map((s) => {
        try {
          return JSON.parse(s.tripData) as Trip;
        } catch {
          return null;
        }
      })
      .filter((t): t is Trip => t !== null);
  } catch {
    // Offline/unauthenticated — proceed with whatever was passed in.
    return [];
  }
}

async function cancelAllTripTypeNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const tripNotifs = scheduled.filter((n) => n.content.data?.type === 'trip');
  await Promise.all(tripNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/**
 * Reconciles local "your trip is coming up" reminders against the given
 * trips (this account's own trips — accepted shared trips are fetched
 * internally, since they aren't necessarily in the caller's list). Always
 * cancels every existing `type: 'trip'` reminder first and reschedules from
 * scratch, so this is safe to call repeatedly from any trip-list-changing
 * action without ever producing duplicates or leaving stale reminders behind
 * for a deleted trip or a date that moved.
 */
export async function reconcileTripReminders(ownedTrips: Trip[]): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    await cancelAllTripTypeNotifications();
  } catch (err) {
    console.warn('[TripNotifs] Failed to cancel existing trip reminders:', err);
    return;
  }

  const sharedTrips = await fetchAcceptedSharedTrips();
  const byId = new Map<string, Trip>();
  for (const trip of [...ownedTrips, ...sharedTrips]) {
    if (trip?.id && trip.startDate) byId.set(trip.id, trip);
  }

  const now = Date.now();
  const upcoming = Array.from(byId.values())
    .filter((trip) => new Date(trip.startDate).getTime() > now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, MAX_TRIPS);

  if (upcoming.length === 0) return;

  const t = await getCurrentTranslations();
  const granted = await ensurePermission(t);
  if (!granted) return;

  for (const trip of upcoming) {
    const start = new Date(trip.startDate);
    const destination = destinationNameOf(trip);

    const sevenDaysBefore = new Date(start);
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);
    sevenDaysBefore.setHours(9, 0, 0, 0);

    const oneDayBefore = new Date(start);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    oneDayBefore.setHours(18, 0, 0, 0);

    if (sevenDaysBefore.getTime() > now) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: reminderId(trip.id, '7d'),
          content: {
            title: t.notifications.tripReminder7d(destination),
            data: { type: 'trip', tripId: trip.id },
            sound: 'default',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: sevenDaysBefore },
        });
      } catch (err) {
        console.warn(`[TripNotifs] Failed to schedule 7-day reminder for trip ${trip.id}:`, err);
      }
    }

    if (oneDayBefore.getTime() > now) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: reminderId(trip.id, '1d'),
          content: {
            title: t.notifications.tripReminder1d(destination),
            data: { type: 'trip', tripId: trip.id },
            sound: 'default',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: oneDayBefore },
        });
      } catch (err) {
        console.warn(`[TripNotifs] Failed to schedule 1-day reminder for trip ${trip.id}:`, err);
      }
    }
  }
}

/** Cancels every scheduled trip reminder — call on logout so none leak to a different account on the same device. */
export async function cancelTripReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await cancelAllTripTypeNotifications();
  } catch (err) {
    console.warn('[TripNotifs] Failed to cancel trip reminders:', err);
  }
}

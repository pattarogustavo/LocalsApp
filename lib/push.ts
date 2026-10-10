import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { ensurePermission } from '@/lib/trip-notifications';

const LAST_TOKEN_KEY = 'voyage_push_token';

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Registers this device's Expo push token with the server. iOS-only: the
 * APNs key is already set up in EAS for the published app, and this never
 * adds expo-device to detect a simulator — getExpoPushTokenAsync() simply
 * fails there (no real APNs token to hand back), which the catch below
 * already treats as a no-op.
 *
 * Idempotent: safe to call on every app open and after every login — it
 * only ever upserts the current token, never creates duplicates. Reuses
 * trip-notifications' permission flow (ensurePermission), which DOES ask —
 * with our own explanatory alert before the system prompt — the first time
 * there's nothing to go on yet; it just means this never prompts with its
 * own separate dialog, since it's the same OS permission trip reminders use.
 * Because that check runs fresh on every call, granting permission later —
 * via that flow's one retry or via iOS Settings — means the very next app
 * open registers the token, with no extra wiring needed here.
 */
export async function registerForPushAsync(language: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const granted = await ensurePermission();
    if (!granted) return;

    const projectId = getProjectId();
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await trpcVanilla.push.register.mutate({ token, platform: Platform.OS, language });
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
  } catch (err) {
    console.warn('[Push] Failed to register for push notifications:', err);
  }
}

/** Unregisters this device's token — call before clearing the session on logout. */
export async function unregisterPushAsync(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (!token) return;
    await trpcVanilla.push.unregister.mutate({ token });
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  } catch (err) {
    console.warn('[Push] Failed to unregister push token:', err);
  }
}

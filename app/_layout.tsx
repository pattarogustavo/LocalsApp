"use client";
import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, KeyboardAvoidingView } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import * as Notifications from "expo-notifications";
import { useAuthStore } from "@/store/auth";
import { useTripsStore } from "@/store/trips";
import { scheduleTrialNotifications } from "@/lib/subscription-notifications";

// Configure how notifications are presented when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";
import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

// Auth guard: redirects unauthenticated users to onboarding
function AuthGuard() {
  const { user, initialized } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const syncWithCloud = useTripsStore((s) => s.syncWithCloud);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === 'auth';
    const inOauthGroup = segments[0] === 'oauth';

    if (!user && !inAuthGroup && !inOauthGroup) {
      // Not logged in, redirect to onboarding
      router.replace('/auth/onboarding' as any);
    } else if (user && inAuthGroup) {
      // Already logged in, redirect to main app
      router.replace('/(tabs)');
    }
  }, [user, initialized, segments]);

  // Sync trips with cloud whenever the user logs in
  useEffect(() => {
    if (user) {
      syncWithCloud().catch(() => {});
    }
  }, [user?.id]);

  return null;
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;
  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);
  const { initialize } = useAuthStore();

  useEffect(() => {
    initManusRuntime();
    // Initialize Supabase session on startup
    initialize().then(() => {
      // Schedule trial notifications after loading auth state
      const { user } = useAuthStore.getState();
      if (user?.trialEndsAt && user.subscriptionStatus === 'trial') {
        scheduleTrialNotifications(user).catch(() => {});
      }
    });
    // Create Android notification channel for flight reminders
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('flight-reminders', {
        name: 'Lembretes de Voo',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
      Notifications.setNotificationChannelAsync('subscription', {
        name: 'Assinatura',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    }
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AuthGuard />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="trip/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="oauth/callback" />
            <Stack.Screen name="auth/onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/register" />
            <Stack.Screen name="auth/forgot-password" />
            <Stack.Screen name="paywall" />
          </Stack>
          <StatusBar style="light" />
        </QueryClientProvider>
      </trpc.Provider>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}

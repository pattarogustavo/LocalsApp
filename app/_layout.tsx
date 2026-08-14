"use client";
import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, KeyboardAvoidingView } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { useAuthStore } from "@/store/auth";
import { useTripsStore } from "@/store/trips";
import { withTimeout } from "@/lib/_core/with-timeout";
import { AnimatedSplash } from "@/components/animated-splash";

// Keep the native splash screen visible until we explicitly hide it below,
// so the app never flashes to a blank screen while auth initializes.
SplashScreen.preventAutoHideAsync().catch(() => {});

import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Rect } from "react-native-safe-area-context";
import { trpc, createTRPCClient } from "@/lib/trpc";

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

    if (!user && !inAuthGroup) {
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
  const insets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const frame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;
  const { initialize } = useAuthStore();
  // AnimatedSplash renders the same compass + wordmark as the native splash,
  // then grows a background-colored circle from the compass's center until
  // it covers the whole screen — this stays up until both that animation and
  // auth initialization are done, so the app never flashes to a blank or
  // wrongly-routed screen. See components/animated-splash.tsx.
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);

  useEffect(() => {
    // Hide the native splash as soon as AnimatedSplash has mounted: its first
    // frame is pixel-identical to the native splash image, so the handoff is
    // invisible, and its own reveal animation needs to actually be visible
    // (not hidden behind the still-showing native splash).
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // Initialize Supabase session on startup
    initialize();
  }, []);

  useEffect(() => {
    // Deferred to the next tick and individually timed out/try-caught so a
    // hung native notifications call can never block startup or the splash
    // screen — none of this gates routing, so it's safe to run fire-and-forget.
    const timer = setTimeout(() => {
      (async () => {
        try {
          await withTimeout(
            (async () => {
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
            })(),
            undefined,
            4000,
          );
        } catch {}

        if (Platform.OS === 'android') {
          try {
            await withTimeout(
              Notifications.setNotificationChannelAsync('flight-reminders', {
                name: 'Lembretes de Voo',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'default',
              }),
              null,
              4000,
            );
          } catch {}

          try {
            await withTimeout(
              Notifications.setNotificationChannelAsync('subscription', {
                name: 'Assinatura',
                importance: Notifications.AndroidImportance.DEFAULT,
                sound: 'default',
              }),
              null,
              4000,
            );
          } catch {}
        }
      })();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

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
    const metrics = initialWindowMetrics ?? { insets, frame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [insets, frame]);

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
            <Stack.Screen name="auth/onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/register" />
            <Stack.Screen name="auth/forgot-password" />
            <Stack.Screen name="paywall" />
            <Stack.Screen name="welcome-offer" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="example-itinerary" options={{ presentation: 'modal' }} />
          </Stack>
          <StatusBar style="light" />
          {showAnimatedSplash && (
            <AnimatedSplash
              onFinished={() => {
                // Defensive/idempotent: already hidden right after mount in
                // the effect above, but guard against any race where it
                // somehow wasn't.
                SplashScreen.hideAsync().catch(() => {});
                setShowAnimatedSplash(false);
              }}
            />
          )}
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

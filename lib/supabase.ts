import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Lazy storage adapter that only imports native modules at runtime (not at module evaluation time).
 * This prevents "window is not defined" crashes when Metro bundles for web/Node SSR.
 */
const LazyStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === "web") {
      // Web: use localStorage if available, otherwise no-op
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
      return null;
    }
    // Native: use SecureStore with AsyncStorage fallback
    try {
      const SecureStore = await import("expo-secure-store");
      return await SecureStore.getItemAsync(key);
    } catch {
      try {
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        return await AsyncStorage.getItem(key);
      } catch {
        return null;
      }
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
      return;
    }
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(key, value);
    } catch {
      // SecureStore has a 2048 byte limit; fall back to AsyncStorage for large tokens
      try {
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        await AsyncStorage.setItem(key, value);
      } catch {}
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
      return;
    }
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(key);
    } catch {
      try {
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        await AsyncStorage.removeItem(key);
      } catch {}
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LazyStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

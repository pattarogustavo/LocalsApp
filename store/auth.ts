import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_USER_KEY = 'voyage_auth_user';
const AUTH_TOKEN_KEY = 'voyage_auth_token';
const LANG_KEY = 'voyage_preferred_language';

export interface AuthUser {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'cancelled' | null;
  subscriptionPlan: 'monthly' | 'annual' | null;
  subscriptionExpiresAt: string | null; // ISO string
  trialEndsAt: string | null; // ISO string
  avatarUri?: string | null;         // local URI of profile photo
  preferredLanguage?: string | null; // e.g. 'pt', 'en', 'es'
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  initialized: boolean;
  // Language is stored separately so it survives logout
  preferredLanguage: string;
  setUser: (user: AuthUser | null) => void;
  setToken: (token: string | null) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateSubscription: (data: Partial<AuthUser>) => void;
  updateProfile: (data: Partial<AuthUser>) => void;
  setLanguage: (lang: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,
  initialized: false,
  preferredLanguage: 'pt',

  setUser: (user) => {
    set({ user });
    if (user) {
      AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      // If user has a language preference, sync it to the top-level language state
      if (user.preferredLanguage) {
        set({ preferredLanguage: user.preferredLanguage });
        AsyncStorage.setItem(LANG_KEY, user.preferredLanguage);
      }
    } else {
      AsyncStorage.removeItem(AUTH_USER_KEY);
    }
  },

  setToken: (token) => {
    set({ token });
    if (token) {
      AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    }
  },

  logout: async () => {
    // Keep language preference even after logout
    const lang = get().preferredLanguage;
    await AsyncStorage.multiRemove([AUTH_USER_KEY, AUTH_TOKEN_KEY]);
    set({ user: null, token: null, preferredLanguage: lang });
  },

  loadFromStorage: async () => {
    try {
      const [userJson, token, savedLang] = await Promise.all([
        AsyncStorage.getItem(AUTH_USER_KEY),
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
        AsyncStorage.getItem(LANG_KEY),
      ]);
      const user = userJson ? JSON.parse(userJson) as AuthUser : null;
      // Priority: user.preferredLanguage > savedLang > 'pt'
      const lang = user?.preferredLanguage ?? savedLang ?? 'pt';
      set({ user, token, loading: false, initialized: true, preferredLanguage: lang });
    } catch {
      set({ user: null, token: null, loading: false, initialized: true });
    }
  },

  setLanguage: (lang: string) => {
    set({ preferredLanguage: lang });
    AsyncStorage.setItem(LANG_KEY, lang);
    // Also update user object if logged in
    const current = get().user;
    if (current) {
      const updated = { ...current, preferredLanguage: lang };
      set({ user: updated });
      AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
    }
  },

  updateProfile: (data) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ user: updated });
    AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
    // If language is being updated, also update the top-level language state
    if (data.preferredLanguage) {
      set({ preferredLanguage: data.preferredLanguage });
      AsyncStorage.setItem(LANG_KEY, data.preferredLanguage);
    }
  },

  updateSubscription: (data) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ user: updated });
    AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
  },
}));

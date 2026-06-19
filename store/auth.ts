import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_USER_KEY = 'voyage_auth_user';
const AUTH_TOKEN_KEY = 'voyage_auth_token';

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
  setUser: (user: AuthUser | null) => void;
  setToken: (token: string | null) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateSubscription: (data: Partial<AuthUser>) => void;
  updateProfile: (data: Partial<AuthUser>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,
  initialized: false,

  setUser: (user) => {
    set({ user });
    if (user) {
      AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
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
    await AsyncStorage.multiRemove([AUTH_USER_KEY, AUTH_TOKEN_KEY]);
    set({ user: null, token: null });
  },

  loadFromStorage: async () => {
    try {
      const [userJson, token] = await Promise.all([
        AsyncStorage.getItem(AUTH_USER_KEY),
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
      ]);
      const user = userJson ? JSON.parse(userJson) as AuthUser : null;
      set({ user, token, loading: false, initialized: true });
    } catch {
      set({ user: null, token: null, loading: false, initialized: true });
    }
  },

  updateProfile: (data) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ user: updated });
    AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
  },

  updateSubscription: (data) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ user: updated });
    AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
  },
}));

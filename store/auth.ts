import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/_core/with-timeout';
import { logoutRevenueCat } from '@/config/revenuecat';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

const LANG_KEY = 'voyage_preferred_language';
const PROFILE_KEY = 'voyage_user_profile';
const THEME_KEY = 'voyage_theme_mode';
const WELCOME_OFFER_KEY = 'voyage_has_seen_welcome_offer';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AuthUser {
  id: string;           // Supabase UUID
  email: string | null;
  name: string | null;
  bio?: string | null;
  subscriptionStatus: 'active' | 'expired' | 'cancelled' | null;
  subscriptionPlan: 'monthly' | 'annual' | null;
  subscriptionExpiresAt: string | null;
  avatarUri?: string | null;
  preferredLanguage?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  preferredLanguage: string;
  themeMode: ThemeMode;
  hasSeenWelcomeOffer: boolean;

  // Actions
  setSession: (session: Session | null) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  updateProfile: (data: Partial<AuthUser>) => void;
  updateSubscription: (data: Partial<AuthUser>) => void;
  setLanguage: (lang: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  markWelcomeOfferSeen: () => void;

  // Computed helpers
  get token(): string | null;
}

function supabaseUserToAuthUser(
  supabaseUser: SupabaseUser,
  profile?: Partial<AuthUser> | null,
): AuthUser {
  const meta = supabaseUser.user_metadata ?? {};
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? null,
    name: meta.full_name ?? meta.name ?? profile?.name ?? null,
    bio: profile?.bio ?? null,
    subscriptionStatus: profile?.subscriptionStatus ?? null,
    subscriptionPlan: profile?.subscriptionPlan ?? null,
    subscriptionExpiresAt: profile?.subscriptionExpiresAt ?? null,
    avatarUri: profile?.avatarUri ?? null,
    preferredLanguage: profile?.preferredLanguage ?? null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  initialized: false,
  preferredLanguage: 'pt',
  themeMode: 'system',
  hasSeenWelcomeOffer: false,

  get token() {
    return get().session?.access_token ?? null;
  },

  setSession: async (session) => {
    if (!session) {
      set({ user: null, session: null });
      return;
    }
    // Load cached profile extras (subscription, avatar, language)
    let profile: Partial<AuthUser> | null = null;
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      if (raw) profile = JSON.parse(raw);
    } catch {}

    const user = supabaseUserToAuthUser(session.user, profile);
    const lang = user.preferredLanguage ?? profile?.preferredLanguage ?? (await AsyncStorage.getItem(LANG_KEY)) ?? 'pt';
    set({ session, user, preferredLanguage: lang });
  },

  logout: async () => {
    const lang = get().preferredLanguage;
    await supabase.auth.signOut();
    await logoutRevenueCat().catch(() => {});
    await AsyncStorage.multiRemove([PROFILE_KEY]);
    set({ user: null, session: null, preferredLanguage: lang });
  },

  initialize: async () => {
    let initializedSafely = false;
    try {
      const savedLang = await withTimeout(AsyncStorage.getItem(LANG_KEY), null);
      const savedTheme = await withTimeout(AsyncStorage.getItem(THEME_KEY), null) as ThemeMode | null;
      const themeMode: ThemeMode = savedTheme ?? 'system';
      const savedWelcomeOffer = await withTimeout(AsyncStorage.getItem(WELCOME_OFFER_KEY), null);
      const hasSeenWelcomeOffer = savedWelcomeOffer === '1';
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        { data: { session: null }, error: null },
      );

      if (session) {
        const profileRaw = await withTimeout(AsyncStorage.getItem(PROFILE_KEY), null);
        let profile: Partial<AuthUser> | null = null;
        try {
          if (profileRaw) profile = JSON.parse(profileRaw);
        } catch {}
        const user = supabaseUserToAuthUser(session.user, profile);
        const lang = user.preferredLanguage ?? savedLang ?? 'pt';
        set({ session, user, loading: false, initialized: true, preferredLanguage: lang, themeMode, hasSeenWelcomeOffer });
      } else {
        set({ session: null, user: null, loading: false, initialized: true, preferredLanguage: savedLang ?? 'pt', themeMode, hasSeenWelcomeOffer });
      }
      initializedSafely = true;
    } catch {
      set({ session: null, user: null, loading: false, initialized: true });
      initializedSafely = true;
    } finally {
      // Absolute last resort: no matter what happened above, never leave the app stuck on splash.
      if (!initializedSafely) {
        set({ session: null, user: null, loading: false, initialized: true });
      }
    }
  },

  setLanguage: (lang: string) => {
    set({ preferredLanguage: lang });
    AsyncStorage.setItem(LANG_KEY, lang);
    const current = get().user;
    if (current) {
      const updated = { ...current, preferredLanguage: lang };
      set({ user: updated });
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    }
  },

  setThemeMode: (mode: ThemeMode) => {
    set({ themeMode: mode });
    AsyncStorage.setItem(THEME_KEY, mode);
  },

  markWelcomeOfferSeen: () => {
    set({ hasSeenWelcomeOffer: true });
    AsyncStorage.setItem(WELCOME_OFFER_KEY, '1');
  },

  updateProfile: (data) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ user: updated });
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
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
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
  },
}));

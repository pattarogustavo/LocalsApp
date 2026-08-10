import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/_core/with-timeout';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

const LANG_KEY = 'voyage_preferred_language';
const PROFILE_KEY = 'voyage_user_profile';

export interface AuthUser {
  id: string;           // Supabase UUID
  email: string | null;
  name: string | null;
  bio?: string | null;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'cancelled' | null;
  subscriptionPlan: 'monthly' | 'annual' | null;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  avatarUri?: string | null;
  preferredLanguage?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  preferredLanguage: string;

  // Actions
  setSession: (session: Session | null) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  updateProfile: (data: Partial<AuthUser>) => void;
  updateSubscription: (data: Partial<AuthUser>) => void;
  setLanguage: (lang: string) => void;

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
    trialEndsAt: profile?.trialEndsAt ?? null,
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
    await AsyncStorage.multiRemove([PROFILE_KEY]);
    set({ user: null, session: null, preferredLanguage: lang });
  },

  initialize: async () => {
    let initializedSafely = false;
    try {
      const savedLang = await withTimeout(AsyncStorage.getItem(LANG_KEY), null);
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
        set({ session, user, loading: false, initialized: true, preferredLanguage: lang });
      } else {
        set({ session: null, user: null, loading: false, initialized: true, preferredLanguage: savedLang ?? 'pt' });
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

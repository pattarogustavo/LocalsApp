import { Platform } from "react-native";

// Legacy User type kept for backward compatibility
export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: Date;
};

export async function getSessionToken(): Promise<string | null> {
  try {
    // Read the Supabase access token from the auth store
    const { useAuthStore } = await import("@/store/auth");
    const token = useAuthStore.getState().token;
    return token ?? null;
  } catch (error) {
    console.error("[Auth] Failed to get session token:", error);
    return null;
  }
}

// No-op: Supabase manages the session internally
export async function setSessionToken(_token: string): Promise<void> {}

// No-op: Supabase manages the session internally
export async function removeSessionToken(): Promise<void> {}

// No-ops: user info is managed by Supabase auth store
export async function getUserInfo(): Promise<User | null> { return null; }
export async function setUserInfo(_user: User): Promise<void> {}
export async function clearUserInfo(): Promise<void> {}

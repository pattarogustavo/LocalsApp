import { useAuthStore } from "@/store/auth";

/**
 * Thin wrapper around the Supabase-backed auth store, exposing the interface
 * screens have historically depended on: user, isAuthenticated, loading, logout.
 */
export function useAuth() {
  const { user, loading, logout } = useAuthStore();

  return {
    user,
    isAuthenticated: Boolean(user),
    loading,
    logout,
  };
}

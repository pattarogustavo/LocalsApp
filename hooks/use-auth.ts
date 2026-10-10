import { useAuthStore } from "@/store/auth";
import { useShallow } from "zustand/react/shallow";

/**
 * Thin wrapper around the Supabase-backed auth store, exposing the interface
 * screens have historically depended on: user, isAuthenticated, loading, logout.
 */
export function useAuth() {
  const { user, loading, logout } = useAuthStore(
    useShallow((s) => ({ user: s.user, loading: s.loading, logout: s.logout })),
  );

  return {
    user,
    isAuthenticated: Boolean(user),
    loading,
    logout,
  };
}

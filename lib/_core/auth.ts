export async function getSessionToken(): Promise<string | null> {
  try {
    const { useAuthStore } = await import("@/store/auth");
    const token = useAuthStore.getState().token;
    return token ?? null;
  } catch (error) {
    console.error("[Auth] Failed to get session token:", error);
    return null;
  }
}

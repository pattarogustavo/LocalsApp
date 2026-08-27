export async function getSessionToken(): Promise<string | null> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return data.session.access_token;
  } catch (error) {
    console.error("[Auth] Failed to get session token:", error);
    return null;
  }
}

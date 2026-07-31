import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service role key (bypasses RLS). */
export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
      throw new Error(
        "Supabase admin client is not configured: set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    client = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

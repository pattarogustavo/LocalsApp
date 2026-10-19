export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Supabase Auth
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? "",
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  // Supabase Storage (server-side, service role)
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "",
  // OpenAI — sole runtime AI provider for the itinerary engine (migrated off
  // Anthropic; see server/_core/llm.ts). Server-side only — never read from
  // EXPO_PUBLIC_* or exposed to the client bundle.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // gpt-6.1-sol: current-generation GPT-6 family model, chosen over the
  // flagship gpt-6-astra for cost/latency (5x cheaper both ways per OpenAI's
  // published pricing as of 2026-10) while still being a modern model with
  // strict Structured Outputs support — appropriate for the itinerary
  // engine's multi-step constraint reasoning. See docs/itinerary-audit.md /
  // the migration report for sourcing details.
  openaiModel: process.env.OPENAI_MODEL || "gpt-6.1-sol",
};

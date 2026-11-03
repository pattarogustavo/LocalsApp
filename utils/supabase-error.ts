// Supabase returns HTTP 429 (code "over_email_send_rate_limit") when an
// email-sending auth call (resetPasswordForEmail, signUp, etc.) is retried
// too soon. The message text varies by project config, so status/code are
// checked first and the message is only a fallback.
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string; message?: string };
  if (e.status === 429) return true;
  if (typeof e.code === 'string' && e.code.includes('rate_limit')) return true;
  if (typeof e.message === 'string' && e.message.toLowerCase().includes('rate limit')) return true;
  return false;
}

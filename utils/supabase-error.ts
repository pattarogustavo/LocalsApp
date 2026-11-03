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

// A network-level failure (offline, timeout, DNS, ...) rather than a rejection
// from Supabase itself — auth-js wraps these as AuthRetryableFetchError, and
// in practice they also come through with no HTTP status at all. Treated
// separately from "invalid code/credentials" so the UI doesn't blame the
// user's input for what's actually a connectivity problem.
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; status?: number };
  if (e.name === 'AuthRetryableFetchError') return true;
  if (typeof e.status !== 'number') return true;
  return false;
}

// Supabase rejects updateUser({ password }) with code "same_password" when
// the new password matches the current one. The message text is checked as
// a fallback since the code isn't always populated depending on the
// supabase-js version and transport used.
export function isSamePasswordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === 'same_password') return true;
  if (typeof e.message === 'string' && e.message.toLowerCase().includes('should be different from the old password')) {
    return true;
  }
  return false;
}

// Supabase rejects updateUser({ password }) with code "weak_password" (and
// an AuthWeakPasswordError instance) when the password fails the project's
// server-side strength policy, independent of our own 6-character minimum.
export function isWeakPasswordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; name?: string };
  if (e.code === 'weak_password') return true;
  if (e.name === 'AuthWeakPasswordError') return true;
  return false;
}

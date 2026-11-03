// Parses the three deep-link shapes Supabase can send for password recovery:
//  - localsapp://auth/reset-password#access_token=...&refresh_token=...&type=recovery
//  - localsapp://auth/reset-password?code=...                 (PKCE flow)
//  - localsapp://auth/reset-password?token_hash=...&type=recovery
// `type` must be exactly "recovery" when present, since the same shapes are
// used by Supabase for other auth flows (signup confirmation, email change).

export type ResetPasswordLinkResult =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'invalid' };

function parseParams(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function parseResetPasswordLink(url: string | null | undefined): ResetPasswordLinkResult {
  if (!url || typeof url !== 'string') return { kind: 'invalid' };

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');

  let query = '';
  let fragment = '';

  if (hashIndex >= 0) {
    fragment = url.slice(hashIndex + 1);
    if (queryIndex >= 0 && queryIndex < hashIndex) {
      query = url.slice(queryIndex + 1, hashIndex);
    }
  } else if (queryIndex >= 0) {
    query = url.slice(queryIndex + 1);
  }

  const fragmentParams = fragment ? parseParams(fragment) : {};
  const queryParams = query ? parseParams(query) : {};

  if (fragmentParams.access_token && fragmentParams.refresh_token) {
    if (fragmentParams.type !== 'recovery') return { kind: 'invalid' };
    return { kind: 'session', accessToken: fragmentParams.access_token, refreshToken: fragmentParams.refresh_token };
  }

  if (queryParams.token_hash) {
    if (queryParams.type !== 'recovery') return { kind: 'invalid' };
    return { kind: 'token_hash', tokenHash: queryParams.token_hash };
  }

  if (queryParams.code) {
    return { kind: 'code', code: queryParams.code };
  }

  return { kind: 'invalid' };
}

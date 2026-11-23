/**
 * Username format rule, shared between the client (instant feedback while
 * typing, before any server round-trip) and the server (the actual
 * enforcement — see server/routers.ts' user.checkUsername/setUsername).
 * Uniqueness itself is enforced by the database (users_username_lower_idx),
 * not by this regex.
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9._]{3,20}$/;

export function isValidUsernameFormat(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Best-effort starting point for the "choose a username" gate shown to
 * pre-existing accounts — never guaranteed available, just a plausible
 * first guess the user can edit before it's checked for real.
 */
export function suggestUsernameFrom(name?: string | null, email?: string | null): string {
  const base = (name || email?.split('@')[0] || 'usuario')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `usuario${Math.floor(Math.random() * 10000)}`;
}

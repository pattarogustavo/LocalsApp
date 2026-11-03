export const SITE_URL = 'https://thelocalstravel.com';
export const SUPPORT_EMAIL = 'suporte@thelocalstravel.com';

function isPortuguese(lang: string | null | undefined): boolean {
  return (lang ?? '').toLowerCase().startsWith('pt');
}

export function privacyUrl(lang: string | null | undefined): string {
  return isPortuguese(lang) ? `${SITE_URL}/pt/privacy/` : `${SITE_URL}/privacy/`;
}

export function supportUrl(lang: string | null | undefined): string {
  return isPortuguese(lang) ? `${SITE_URL}/pt/support/` : `${SITE_URL}/support/`;
}

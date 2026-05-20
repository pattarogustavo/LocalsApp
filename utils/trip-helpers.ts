import type { Trip, Destination, CityTransportMode } from '@/types/voyage';

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function formatDate(dateStr: string, format: 'short' | 'medium' | 'long' = 'medium'): string {
  const date = new Date(dateStr);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  if (format === 'short') {
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }
  if (format === 'medium') {
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  return `${days[date.getDay()]}, ${date.getDate()} de ${monthsFull[date.getMonth()]} de ${date.getFullYear()}`;
}

export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return days[date.getDay()];
}

export function getDaysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getDaysSince(dateStr: string): number {
  return -getDaysUntil(dateStr);
}

export function isTripUpcoming(trip: Trip): boolean {
  return getDaysUntil(trip.startDate) > 0;
}

export function isTripPast(trip: Trip): boolean {
  return getDaysUntil(trip.endDate) < 0;
}

export function isTripOngoing(trip: Trip): boolean {
  const daysUntilStart = getDaysUntil(trip.startDate);
  const daysUntilEnd = getDaysUntil(trip.endDate);
  return daysUntilStart <= 0 && daysUntilEnd >= 0;
}

export function getTripBadge(trip: Trip): string {
  const daysUntil = getDaysUntil(trip.startDate);
  const daysSince = getDaysSince(trip.endDate);

  if (daysUntil > 0) {
    return `em ${daysUntil} dias`;
  } else if (daysSince > 0) {
    return `há ${daysSince} dias`;
  } else {
    return 'hoje';
  }
}

// ─── Creative Trip Name Generator ─────────────────────────────────────────────

const CREATIVE_PREFIXES_SINGLE = [
  'Explorando', 'Descobrindo', 'Vivendo', 'Sonhando em', 'Apaixonado por',
  'Encantado por', 'Aventura em', 'Maravilhas de', 'Memórias em', 'Roteiro em',
];

const CREATIVE_PREFIXES_MULTI = [
  'Grand Tour:', 'Rota Europeia:', 'Expedição:', 'Aventura por', 'Descobrindo',
  'Explorando', 'Viagem por', 'Passagem por',
];

export function getTripName(trip: Trip): string {
  if (trip.name) return trip.name;
  const dests = trip.destinations;
  if (dests.length === 0) return `Viagem de ${trip.totalDays} Dias`;

  if (dests.length === 1) {
    const prefix = CREATIVE_PREFIXES_SINGLE[
      Math.abs(hashString(dests[0].name)) % CREATIVE_PREFIXES_SINGLE.length
    ];
    return `${prefix} ${dests[0].name}`;
  }

  if (dests.length === 2) {
    return `${dests[0].name} & ${dests[1].name}`;
  }

  // 3+ destinations
  const prefix = CREATIVE_PREFIXES_MULTI[
    Math.abs(hashString(dests.map((d) => d.name).join())) % CREATIVE_PREFIXES_MULTI.length
  ];
  const names = dests.map((d) => d.name).join(', ');
  return `${prefix} ${names}`;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

// ─── Currency Helpers ─────────────────────────────────────────────────────────

export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    BRL: 'R$',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    ARS: '$',
    CLP: '$',
    MXN: '$',
    CAD: 'CA$',
    AUD: 'A$',
    CHF: 'Fr',
    NOK: 'kr',
    SEK: 'kr',
    DKK: 'kr',
    NZD: 'NZ$',
    SGD: 'S$',
    HKD: 'HK$',
    THB: '฿',
    IDR: 'Rp',
    MYR: 'RM',
    PHP: '₱',
    INR: '₹',
    ZAR: 'R',
    AED: 'د.إ',
    TRY: '₺',
    PLN: 'zł',
    CZK: 'Kč',
    HUF: 'Ft',
    RON: 'lei',
    ILS: '₪',
    KRW: '₩',
    TWD: 'NT$',
    VND: '₫',
    EGP: 'E£',
    MAD: 'MAD',
    COP: '$',
    PEN: 'S/',
    UYU: '$U',
    BOB: 'Bs',
    PYG: '₲',
  };
  return symbols[currency] || currency;
}

// Map country name → currency code
const COUNTRY_CURRENCY: Record<string, string> = {
  // South America
  'Brasil': 'BRL',
  'Brazil': 'BRL',
  'Argentina': 'ARS',
  'Chile': 'CLP',
  'Colômbia': 'COP',
  'Colombia': 'COP',
  'Peru': 'PEN',
  'Uruguai': 'UYU',
  'Uruguay': 'UYU',
  'Bolívia': 'BOB',
  'Bolivia': 'BOB',
  'Paraguai': 'PYG',
  'Paraguay': 'PYG',
  // North America
  'Estados Unidos': 'USD',
  'United States': 'USD',
  'EUA': 'USD',
  'USA': 'USD',
  'Canadá': 'CAD',
  'Canada': 'CAD',
  'México': 'MXN',
  'Mexico': 'MXN',
  // Europe
  'França': 'EUR',
  'France': 'EUR',
  'Alemanha': 'EUR',
  'Germany': 'EUR',
  'Itália': 'EUR',
  'Italy': 'EUR',
  'Espanha': 'EUR',
  'Spain': 'EUR',
  'Portugal': 'EUR',
  'Grécia': 'EUR',
  'Greece': 'EUR',
  'Holanda': 'EUR',
  'Netherlands': 'EUR',
  'Bélgica': 'EUR',
  'Belgium': 'EUR',
  'Áustria': 'EUR',
  'Austria': 'EUR',
  'Finlândia': 'EUR',
  'Finland': 'EUR',
  'Irlanda': 'EUR',
  'Ireland': 'EUR',
  'Luxemburgo': 'EUR',
  'Luxembourg': 'EUR',
  'Malta': 'EUR',
  'Eslováquia': 'EUR',
  'Slovakia': 'EUR',
  'Eslovênia': 'EUR',
  'Slovenia': 'EUR',
  'Croácia': 'EUR',
  'Croatia': 'EUR',
  'Reino Unido': 'GBP',
  'United Kingdom': 'GBP',
  'Suíça': 'CHF',
  'Switzerland': 'CHF',
  'Noruega': 'NOK',
  'Norway': 'NOK',
  'Suécia': 'SEK',
  'Sweden': 'SEK',
  'Dinamarca': 'DKK',
  'Denmark': 'DKK',
  'República Tcheca': 'CZK',
  'Czech Republic': 'CZK',
  'Hungria': 'HUF',
  'Hungary': 'HUF',
  'Polônia': 'PLN',
  'Poland': 'PLN',
  'Romênia': 'RON',
  'Romania': 'RON',
  'Turquia': 'TRY',
  'Turkey': 'TRY',
  // Asia
  'Japão': 'JPY',
  'Japan': 'JPY',
  'China': 'CNY',
  'Coreia do Sul': 'KRW',
  'South Korea': 'KRW',
  'Tailândia': 'THB',
  'Thailand': 'THB',
  'Indonésia': 'IDR',
  'Indonesia': 'IDR',
  'Malásia': 'MYR',
  'Malaysia': 'MYR',
  'Filipinas': 'PHP',
  'Philippines': 'PHP',
  'Índia': 'INR',
  'India': 'INR',
  'Singapura': 'SGD',
  'Singapore': 'SGD',
  'Cingapura': 'SGD',
  'Hong Kong': 'HKD',
  'Taiwan': 'TWD',
  'Vietnã': 'VND',
  'Vietnam': 'VND',
  'Emirados Árabes': 'AED',
  'United Arab Emirates': 'AED',
  'UAE': 'AED',
  'Israel': 'ILS',
  // Africa & Oceania
  'África do Sul': 'ZAR',
  'South Africa': 'ZAR',
  'Marrocos': 'MAD',
  'Morocco': 'MAD',
  'Egito': 'EGP',
  'Egypt': 'EGP',
  'Austrália': 'AUD',
  'Australia': 'AUD',
  'Nova Zelândia': 'NZD',
  'New Zealand': 'NZD',
};

export function getCurrencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country] || 'USD';
}

/**
 * Returns unique currencies for all destinations in a trip.
 * Each entry: { currency: 'EUR', flag: '🇫🇷', symbol: '€' }
 */
export function getTripCurrencies(destinations: Destination[]): Array<{ currency: string; flag: string; symbol: string; country: string }> {
  const seen = new Set<string>();
  const result: Array<{ currency: string; flag: string; symbol: string; country: string }> = [];

  for (const dest of destinations) {
    const currency = dest.currency || getCurrencyForCountry(dest.country);
    if (!seen.has(currency)) {
      seen.add(currency);
      result.push({
        currency,
        flag: getCountryFlag(dest.country),
        symbol: getCurrencySymbol(currency),
        country: dest.country,
      });
    }
  }

  return result;
}

// ─── Flag Helpers ─────────────────────────────────────────────────────────────

export function getCountryFlag(country: string): string {
  const flags: Record<string, string> = {
    'Brasil': '🇧🇷', 'Brazil': '🇧🇷',
    'Estados Unidos': '🇺🇸', 'United States': '🇺🇸', 'EUA': '🇺🇸', 'USA': '🇺🇸',
    'França': '🇫🇷', 'France': '🇫🇷',
    'Itália': '🇮🇹', 'Italy': '🇮🇹',
    'Reino Unido': '🇬🇧', 'United Kingdom': '🇬🇧',
    'Japão': '🇯🇵', 'Japan': '🇯🇵',
    'Espanha': '🇪🇸', 'Spain': '🇪🇸',
    'Portugal': '🇵🇹',
    'Alemanha': '🇩🇪', 'Germany': '🇩🇪',
    'Argentina': '🇦🇷',
    'México': '🇲🇽', 'Mexico': '🇲🇽',
    'Canadá': '🇨🇦', 'Canada': '🇨🇦',
    'Austrália': '🇦🇺', 'Australia': '🇦🇺',
    'China': '🇨🇳',
    'Coreia do Sul': '🇰🇷', 'South Korea': '🇰🇷',
    'Índia': '🇮🇳', 'India': '🇮🇳',
    'Tailândia': '🇹🇭', 'Thailand': '🇹🇭',
    'Indonésia': '🇮🇩', 'Indonesia': '🇮🇩',
    'Singapura': '🇸🇬', 'Singapore': '🇸🇬', 'Cingapura': '🇸🇬',
    'Emirados Árabes': '🇦🇪', 'United Arab Emirates': '🇦🇪', 'UAE': '🇦🇪',
    'Holanda': '🇳🇱', 'Netherlands': '🇳🇱',
    'Bélgica': '🇧🇪', 'Belgium': '🇧🇪',
    'Suíça': '🇨🇭', 'Switzerland': '🇨🇭',
    'Áustria': '🇦🇹', 'Austria': '🇦🇹',
    'Grécia': '🇬🇷', 'Greece': '🇬🇷',
    'Turquia': '🇹🇷', 'Turkey': '🇹🇷',
    'Marrocos': '🇲🇦', 'Morocco': '🇲🇦',
    'África do Sul': '🇿🇦', 'South Africa': '🇿🇦',
    'Nova Zelândia': '🇳🇿', 'New Zealand': '🇳🇿',
    'Chile': '🇨🇱',
    'Colômbia': '🇨🇴', 'Colombia': '🇨🇴',
    'Peru': '🇵🇪',
    'Noruega': '🇳🇴', 'Norway': '🇳🇴',
    'Suécia': '🇸🇪', 'Sweden': '🇸🇪',
    'Dinamarca': '🇩🇰', 'Denmark': '🇩🇰',
    'Polônia': '🇵🇱', 'Poland': '🇵🇱',
    'República Tcheca': '🇨🇿', 'Czech Republic': '🇨🇿',
    'Hungria': '🇭🇺', 'Hungary': '🇭🇺',
    'Israel': '🇮🇱',
    'Filipinas': '🇵🇭', 'Philippines': '🇵🇭',
    'Vietnã': '🇻🇳', 'Vietnam': '🇻🇳',
    'Malásia': '🇲🇾', 'Malaysia': '🇲🇾',
    'Hong Kong': '🇭🇰',
    'Taiwan': '🇹🇼',
    'Egito': '🇪🇬', 'Egypt': '🇪🇬',
    'Irlanda': '🇮🇪', 'Ireland': '🇮🇪',
    'Croácia': '🇭🇷', 'Croatia': '🇭🇷',
  };
  return flags[country] || '🌍';
}

// ─── City Transport Mode ──────────────────────────────────────────────────────

export function getCityTransportLabel(mode: CityTransportMode): string {
  const labels: Record<CityTransportMode, string> = {
    car: 'Carro',
    public: 'Transporte Público',
    uber: 'Uber/Táxi',
    walk: 'A Pé',
    bike: 'Bicicleta',
    taxi: 'Táxi',
  };
  return labels[mode] || mode;
}

export function getCityTransportIcon(mode: CityTransportMode): string {
  const icons: Record<CityTransportMode, string> = {
    car: 'car-outline',
    public: 'bus-outline',
    uber: 'car-sport-outline',
    walk: 'walk-outline',
    bike: 'bicycle-outline',
    taxi: 'car-outline',
  };
  return icons[mode] || 'navigate-outline';
}

// ─── Expense / Spot Helpers ───────────────────────────────────────────────────

export function getTotalExpenses(trip: Trip): number {
  return trip.expenses.reduce((sum, e) => sum + e.amount, 0);
}

export function getTotalSpots(trip: Trip): number {
  return trip.places.length;
}
